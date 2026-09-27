"""Structural validation of a proposed workflow graph.

Errors mean the graph must not reach the canvas: it would not deploy, or it
would deploy and get stuck. Warnings are legal BPMN that is probably not
what the author meant; they are surfaced (Review mode) but don't block.

Codes are stable: the repair loop sends them back to the model and the SPA
links them to nodes, so never renumber an existing code.
"""

from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Literal

from .graph import ACTIVITY_TYPES, FIELD_APPLICABILITY, GATEWAY_TYPES, WorkflowGraph

Severity = Literal["error", "warning"]


@dataclass(frozen=True)
class Issue:
    code: str
    severity: Severity
    message: str
    node_ids: tuple[str, ...] = field(default=())
    edge_ids: tuple[str, ...] = field(default=())


def errors(issues: list[Issue]) -> list[Issue]:
    return [i for i in issues if i.severity == "error"]


def validate(graph: WorkflowGraph) -> list[Issue]:
    issues: list[Issue] = []

    def err(code: str, message: str, nodes=(), edges=()) -> None:
        issues.append(Issue(code, "error", message, tuple(nodes), tuple(edges)))

    def warn(code: str, message: str, nodes=(), edges=()) -> None:
        issues.append(Issue(code, "warning", message, tuple(nodes), tuple(edges)))

    # AD001: ids are shared by nodes and edges in BPMN XML, so they must be
    # unique across both.
    seen: set[str] = set()
    for item_id in [n.id for n in graph.nodes] + [e.id for e in graph.edges]:
        if item_id in seen:
            err("AD001", f"Duplicate id '{item_id}'.", nodes=[item_id])
        seen.add(item_id)

    nodes = {n.id: n for n in graph.nodes}

    # AD002 / AD003: edges must connect two existing, distinct nodes. Later
    # graph checks only use edges that pass, so one bad edge produces one
    # issue rather than a cascade.
    edges = []
    for e in graph.edges:
        missing = [end for end in (e.source, e.target) if end not in nodes]
        if missing:
            err("AD002", f"Flow '{e.id}' points to missing node(s) {missing}.", edges=[e.id])
        elif e.source == e.target:
            err("AD003", f"Flow '{e.id}' loops from '{e.source}' to itself.", nodes=[e.source], edges=[e.id])
        else:
            edges.append(e)

    outgoing = defaultdict(list)
    incoming = defaultdict(list)
    for e in edges:
        outgoing[e.source].append(e)
        incoming[e.target].append(e)

    starts = [n.id for n in graph.nodes if n.type == "startEvent"]
    ends = [n.id for n in graph.nodes if n.type == "endEvent"]

    # AD004 / AD005 / AD006: Flowable needs exactly one none-start event for
    # a process started from the platform, and at least one end.
    if not starts:
        err("AD004", "The process has no start event.")
    elif len(starts) > 1:
        err("AD005", f"The process has {len(starts)} start events; use exactly one.", nodes=starts)
    if not ends:
        err("AD006", "The process has no end event.")

    # AD007 / AD008
    for s in starts:
        if incoming[s]:
            err("AD007", f"Start event '{s}' has incoming flows.", nodes=[s], edges=[e.id for e in incoming[s]])
    for t in ends:
        if outgoing[t]:
            err("AD008", f"End event '{t}' has outgoing flows.", nodes=[t], edges=[e.id for e in outgoing[t]])

    # AD009: everything must be reachable from the start, or it can never run.
    if len(starts) == 1:
        reachable = _reach(starts[0], lambda n: (e.target for e in outgoing[n]))
        for n in graph.nodes:
            if n.id not in reachable:
                err("AD009", f"'{n.label or n.id}' can never be reached from the start event.", nodes=[n.id])

    # AD010: everything must be able to reach an end, or an instance that
    # gets there is stuck forever.
    if ends:
        can_finish: set[str] = set()
        for t in ends:
            can_finish |= _reach(t, lambda n: (e.source for e in incoming[n]))
        for n in graph.nodes:
            if n.id not in can_finish:
                err("AD010", f"'{n.label or n.id}' has no path to an end event.", nodes=[n.id])

    for n in graph.nodes:
        outs = outgoing[n.id]

        # AD011: an exclusive/inclusive split with several unconditioned
        # flows is ambiguous. One unconditioned flow is the fallback branch.
        if n.type in ("exclusiveGateway", "inclusiveGateway") and len(outs) > 1:
            bare = [e.id for e in outs if not (e.condition_expression or "").strip()]
            if len(bare) > 1:
                err(
                    "AD011",
                    f"Gateway '{n.label or n.id}' has {len(bare)} branches without a condition; "
                    "give every branch a condition except at most one fallback.",
                    nodes=[n.id],
                    edges=bare,
                )

        # AD012: Flowable ignores conditions on a parallel split.
        if n.type == "parallelGateway":
            conditioned = [e.id for e in outs if e.condition_expression]
            if conditioned:
                warn("AD012", f"Parallel gateway '{n.label or n.id}' ignores branch conditions.", nodes=[n.id], edges=conditioned)

        # AD013: several flows out of a non-gateway is an implicit parallel
        # split; legal, but usually a missing gateway.
        if n.type not in GATEWAY_TYPES and len(outs) > 1:
            warn(
                "AD013",
                f"'{n.label or n.id}' has {len(outs)} outgoing flows; add a gateway to make the split explicit.",
                nodes=[n.id],
                edges=[e.id for e in outs],
            )

        # AD014: fields that do nothing for this node type.
        for field_name, allowed in FIELD_APPLICABILITY.items():
            value = n.model_dump(by_alias=True).get(field_name)
            if value and n.type not in allowed:
                err("AD014", f"'{field_name}' has no effect on a {n.type} ('{n.label or n.id}').", nodes=[n.id])

        # AD015: unnamed activities are unreadable in the task list.
        if n.type in ACTIVITY_TYPES and not n.label.strip():
            warn("AD015", f"Activity '{n.id}' has no label.", nodes=[n.id])

    # AD016: two flows between the same pair of nodes.
    pairs: dict[tuple[str, str], list[str]] = defaultdict(list)
    for e in edges:
        pairs[(e.source, e.target)].append(e.id)
    for (src, dst), ids in pairs.items():
        if len(ids) > 1:
            warn("AD016", f"{len(ids)} flows from '{src}' to '{dst}'.", nodes=[src, dst], edges=ids)

    return issues


def _reach(start: str, neighbours) -> set[str]:
    seen = {start}
    queue = deque([start])
    while queue:
        for nxt in neighbours(queue.popleft()):
            if nxt not in seen:
                seen.add(nxt)
                queue.append(nxt)
    return seen
