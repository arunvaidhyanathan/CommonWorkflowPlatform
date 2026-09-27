"""Conversion between WorkflowGraph and the Designer SPA's canvas format.

The canvas format is ``GraphSnapshot`` (Designer/src/data/workflows.ts):
React Flow nodes and edges, the same shape ``parseBpmnXml`` produces in
Designer/src/adapters/bpmnAdapter.ts and that ``workflow_versions.graph_json``
stores. Layout is not the agent's job: every node gets the same position, which
is exactly what the SPA's ``needsAutoLayout`` looks for before running
``applyAutoLayout``.
"""

from typing import Any

from pydantic import ValidationError

from .graph import Edge, Node, WorkflowGraph

_UNLAID_POSITION = {"x": 0, "y": 0}
_NODE_DATA_FIELDS = (
    "label",
    "documentation",
    "assignee",
    "candidateGroups",
    "delegateExpression",
    "formKey",
)


class CanvasConversionError(ValueError):
    pass


def to_canvas(graph: WorkflowGraph) -> dict[str, Any]:
    nodes = []
    for n in graph.nodes:
        data = n.model_dump(by_alias=True, exclude={"id", "type"}, exclude_none=True)
        if "candidateGroups" in data:
            data["candidateGroups"] = list(data["candidateGroups"])
        nodes.append({"id": n.id, "type": n.type, "position": dict(_UNLAID_POSITION), "data": data})

    edges = []
    for e in graph.edges:
        edge: dict[str, Any] = {
            "id": e.id,
            "source": e.source,
            "target": e.target,
            "label": e.label,
            "type": "smoothstep",
            "data": {},
        }
        if e.condition_expression is not None:
            edge["data"]["conditionExpression"] = e.condition_expression
        edges.append(edge)

    return {"nodes": nodes, "edges": edges}


def from_canvas(snapshot: dict[str, Any]) -> WorkflowGraph:
    """Read the SPA's current canvas so the agent can edit or review it.

    Canvas-only fields (position, size, selection, styling) are dropped.
    Node types the agent can't author (e.g. boundaryEvent, genericNode)
    raise CanvasConversionError rather than being silently dropped, since
    dropping them would make an edit delete them.
    """
    try:
        nodes = []
        for raw in snapshot.get("nodes", []):
            data = raw.get("data") or {}
            fields = {k: data[k] for k in _NODE_DATA_FIELDS if data.get(k) is not None}
            nodes.append(Node.model_validate({"id": raw["id"], "type": raw["type"], **fields}))

        edges = []
        for raw in snapshot.get("edges", []):
            condition = (raw.get("data") or {}).get("conditionExpression")
            edges.append(
                Edge.model_validate(
                    {
                        "id": raw["id"],
                        "source": raw["source"],
                        "target": raw["target"],
                        "label": raw.get("label") or "",
                        "conditionExpression": condition,
                    }
                )
            )
    except (ValidationError, KeyError) as exc:
        raise CanvasConversionError(f"canvas graph is not supported by the agent: {exc}") from exc

    return WorkflowGraph(nodes=tuple(nodes), edges=tuple(edges))
