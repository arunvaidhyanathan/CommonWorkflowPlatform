"""CMMN case contract, validator and canvas conversion (AgenticDesigner.html
phase A4).

Mirrors the Designer's CMMN adapter (Designer/src/adapters/cmmnAdapter.ts):
a single flat case plan. Plan items (human tasks, tasks, milestones,
stages) and sentries are nodes; typed edges wire them:
- onPart: plan item -> sentry, fired by one of the item's standard events;
- entry / exit: sentry -> the plan item whose start / end it gates.
A sentry fires when its onPart events have happened and its optional
if-condition (``conditionExpression``) is true.
"""

from collections import defaultdict
from typing import Any, Literal

from pydantic import Field, ValidationError

from .canvas import CanvasConversionError
from .graph import ID_PATTERN, _Model
from .validator import Issue

CaseNodeType = Literal["cmmnHumanTask", "cmmnTask", "cmmnMilestone", "cmmnStage", "cmmnSentry"]
PLAN_ITEM_TYPES = frozenset({"cmmnHumanTask", "cmmnTask", "cmmnMilestone", "cmmnStage"})
CriterionType = Literal["onPart", "entry", "exit"]
# Plan item lifecycle events a sentry can listen for (CMMN 1.1 standard
# events Flowable supports). Milestones have no work to complete: they occur.
StandardEvent = Literal["complete", "start", "occur", "terminate", "exit"]
MILESTONE_EVENTS = frozenset({"occur", "terminate"})
WORK_ITEM_EVENTS = frozenset({"complete", "start", "terminate", "exit"})


class CaseNode(_Model):
    id: str = Field(pattern=ID_PATTERN)
    type: CaseNodeType
    label: str = ""
    # Human tasks only: whether the case waits for the task to complete.
    is_blocking: bool | None = None
    # Sentries only: the if-part condition, e.g. "${riskScore >= 70}".
    condition_expression: str | None = None


class CaseEdge(_Model):
    id: str = Field(pattern=ID_PATTERN)
    source: str
    target: str
    criterion_type: CriterionType
    # onPart only.
    standard_event: StandardEvent | None = None


class CaseGraph(_Model):
    nodes: tuple[CaseNode, ...] = ()
    edges: tuple[CaseEdge, ...] = ()

    def node(self, node_id: str) -> CaseNode | None:
        return next((n for n in self.nodes if n.id == node_id), None)

    def edge(self, edge_id: str) -> CaseEdge | None:
        return next((e for e in self.edges if e.id == edge_id), None)


def validate_case(graph: CaseGraph) -> list[Issue]:
    """Structural rules CD001-CD011. Same contract as the BPMN validator:
    errors block, warnings don't, codes are stable, issues name their ids."""
    issues: list[Issue] = []

    def err(code, message, nodes=(), edges=()):
        issues.append(Issue(code, "error", message, tuple(nodes), tuple(edges)))

    def warn(code, message, nodes=(), edges=()):
        issues.append(Issue(code, "warning", message, tuple(nodes), tuple(edges)))

    seen: set[str] = set()
    for item_id in [n.id for n in graph.nodes] + [e.id for e in graph.edges]:
        if item_id in seen:
            err("CD001", f"Duplicate id '{item_id}'.", nodes=[item_id])
        seen.add(item_id)

    nodes = {n.id: n for n in graph.nodes}
    plan_items = [n for n in graph.nodes if n.type in PLAN_ITEM_TYPES]
    if not plan_items:
        err("CD002", "The case has no plan items (tasks, milestones or stages).")

    on_parts = defaultdict(list)  # sentry id -> onPart edges into it
    gates = defaultdict(list)  # sentry id -> entry/exit edges out of it
    for e in graph.edges:
        src, dst = nodes.get(e.source), nodes.get(e.target)
        if src is None or dst is None:
            err("CD003", f"Link '{e.id}' points to a missing node.", edges=[e.id])
            continue
        if e.criterion_type == "onPart":
            if src.type not in PLAN_ITEM_TYPES or dst.type != "cmmnSentry":
                err("CD004", f"onPart '{e.id}' must go from a plan item to a sentry.", nodes=[src.id, dst.id], edges=[e.id])
                continue
            if e.standard_event is None:
                err("CD005", f"onPart '{e.id}' needs the event it listens for (e.g. complete).", edges=[e.id])
            else:
                allowed = MILESTONE_EVENTS if src.type == "cmmnMilestone" else WORK_ITEM_EVENTS
                if e.standard_event not in allowed:
                    err("CD006", f"'{src.label or src.id}' never raises '{e.standard_event}'; use one of {sorted(allowed)}.",
                        nodes=[src.id], edges=[e.id])
            on_parts[dst.id].append(e)
        else:
            if src.type != "cmmnSentry" or dst.type not in PLAN_ITEM_TYPES:
                err("CD004", f"{e.criterion_type} link '{e.id}' must go from a sentry to a plan item.",
                    nodes=[src.id, dst.id], edges=[e.id])
                continue
            if e.standard_event is not None:
                err("CD007", f"Only onPart links carry an event; remove it from '{e.id}'.", edges=[e.id])
            gates[src.id].append(e)

    for n in graph.nodes:
        if n.type == "cmmnSentry":
            # CD008: nothing can ever make it fire.
            if not on_parts[n.id] and not (n.condition_expression or "").strip():
                err("CD008", f"Sentry '{n.label or n.id}' has no event and no condition, so it never fires.", nodes=[n.id])
            # CD009: fires, but gates nothing.
            if not gates[n.id]:
                warn("CD009", f"Sentry '{n.label or n.id}' isn't an entry or exit criterion of anything.", nodes=[n.id])
        else:
            if n.condition_expression:
                err("CD010", f"Only sentries have conditions ('{n.label or n.id}' is a {n.type}).", nodes=[n.id])
            if n.is_blocking is not None and n.type != "cmmnHumanTask":
                err("CD010", f"isBlocking applies to human tasks only ('{n.label or n.id}').", nodes=[n.id])
            if not n.label.strip():
                warn("CD011", f"Plan item '{n.id}' has no label.", nodes=[n.id])
    return issues


# --- canvas conversion (GraphSnapshot as the CMMN adapter produces it) ----------------

def case_to_canvas(graph: CaseGraph) -> dict[str, Any]:
    nodes = []
    for n in graph.nodes:
        data: dict[str, Any] = {"label": n.label}
        if n.is_blocking is not None:
            data["isBlocking"] = n.is_blocking
        if n.condition_expression is not None:
            data["conditionExpression"] = n.condition_expression
        nodes.append({"id": n.id, "type": n.type, "position": {"x": 0, "y": 0}, "data": data})
    edges = []
    for e in graph.edges:
        data = {"criterionType": e.criterion_type}
        if e.standard_event is not None:
            data["standardEvent"] = e.standard_event
        edges.append({
            "id": e.id, "source": e.source, "target": e.target, "type": "smoothstep",
            # The adapter labels onParts with their event and criteria with their kind.
            "label": (e.standard_event or "") if e.criterion_type == "onPart" else e.criterion_type,
            "data": data,
        })
    return {"nodes": nodes, "edges": edges}


def case_from_canvas(snapshot: dict[str, Any]) -> CaseGraph:
    try:
        nodes = []
        for raw in snapshot.get("nodes", []):
            data = raw.get("data") or {}
            fields = {"id": raw["id"], "type": raw["type"], "label": data.get("label") or ""}
            if raw["type"] == "cmmnHumanTask" and data.get("isBlocking") is not None:
                fields["isBlocking"] = data["isBlocking"]
            if raw["type"] == "cmmnSentry" and data.get("conditionExpression"):
                fields["conditionExpression"] = data["conditionExpression"]
            nodes.append(CaseNode.model_validate(fields))
        edges = []
        for raw in snapshot.get("edges", []):
            data = raw.get("data") or {}
            fields = {"id": raw["id"], "source": raw["source"], "target": raw["target"],
                      "criterionType": data.get("criterionType")}
            if data.get("criterionType") == "onPart":
                fields["standardEvent"] = data.get("standardEvent") or "complete"
            edges.append(CaseEdge.model_validate(fields))
    except (ValidationError, KeyError) as exc:
        raise CanvasConversionError(f"canvas case is not supported by the agent: {exc}") from exc
    return CaseGraph(nodes=tuple(nodes), edges=tuple(edges))
