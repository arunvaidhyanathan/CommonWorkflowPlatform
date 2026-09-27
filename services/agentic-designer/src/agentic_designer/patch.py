"""Patch operations: how the model proposes edits to an existing graph.

Edit mode returns a list of these instead of a whole new graph, so the SPA
can show exactly what changes and the user can accept or reject it.
``apply_patch`` checks referential integrity (unknown or duplicate ids);
whether the result is a sensible workflow is the validator's job.
"""

from typing import Annotated, Literal

from pydantic import Field, TypeAdapter

from .graph import ID_PATTERN, Edge, Node, WorkflowGraph, _Model


class NodeChanges(_Model):
    """Fields ``update_node`` may change. Not id or type: changing a node's
    type is a remove + add, so its edges are reconsidered explicitly."""

    label: str | None = None
    documentation: str | None = None
    assignee: str | None = None
    candidate_groups: tuple[str, ...] | None = None
    delegate_expression: str | None = None
    form_key: str | None = None


class AddNode(_Model):
    op: Literal["add_node"] = "add_node"
    node: Node


class UpdateNode(_Model):
    op: Literal["update_node"] = "update_node"
    id: str
    changes: NodeChanges


class RemoveNode(_Model):
    """Also removes every edge touching the node."""

    op: Literal["remove_node"] = "remove_node"
    id: str


class Connect(_Model):
    op: Literal["connect"] = "connect"
    edge: Edge


class Disconnect(_Model):
    op: Literal["disconnect"] = "disconnect"
    edge_id: str = Field(pattern=ID_PATTERN)


class SetCondition(_Model):
    """``condition_expression=None`` clears the condition."""

    op: Literal["set_condition"] = "set_condition"
    edge_id: str
    condition_expression: str | None


PatchOp = Annotated[
    AddNode | UpdateNode | RemoveNode | Connect | Disconnect | SetCondition,
    Field(discriminator="op"),
]
PatchOps = TypeAdapter(list[PatchOp])


class PatchError(ValueError):
    def __init__(self, index: int, message: str):
        super().__init__(f"patch op {index}: {message}")
        self.index = index


def apply_patch(graph: WorkflowGraph, ops: list[PatchOp]) -> WorkflowGraph:
    """Apply ops in order and return a new graph; ``graph`` is not modified.

    Raises PatchError naming the first op that refers to something missing
    or reuses an id, so the repair loop can tell the model exactly which op
    to fix.
    """
    nodes = {n.id: n for n in graph.nodes}
    edges = {e.id: e for e in graph.edges}

    def taken(item_id: str) -> bool:
        return item_id in nodes or item_id in edges

    for i, op in enumerate(ops):
        match op:
            case AddNode(node=node):
                if taken(node.id):
                    raise PatchError(i, f"id '{node.id}' is already in use")
                nodes[node.id] = node
            case UpdateNode(id=node_id, changes=changes):
                if node_id not in nodes:
                    raise PatchError(i, f"no node '{node_id}'")
                updates = changes.model_dump(exclude_unset=True)
                nodes[node_id] = nodes[node_id].model_copy(update=updates)
            case RemoveNode(id=node_id):
                if node_id not in nodes:
                    raise PatchError(i, f"no node '{node_id}'")
                del nodes[node_id]
                edges = {
                    k: e for k, e in edges.items() if node_id not in (e.source, e.target)
                }
            case Connect(edge=edge):
                if taken(edge.id):
                    raise PatchError(i, f"id '{edge.id}' is already in use")
                for end in (edge.source, edge.target):
                    if end not in nodes:
                        raise PatchError(i, f"edge '{edge.id}' refers to missing node '{end}'")
                edges[edge.id] = edge
            case Disconnect(edge_id=edge_id):
                if edge_id not in edges:
                    raise PatchError(i, f"no edge '{edge_id}'")
                del edges[edge_id]
            case SetCondition(edge_id=edge_id, condition_expression=expr):
                if edge_id not in edges:
                    raise PatchError(i, f"no edge '{edge_id}'")
                edges[edge_id] = edges[edge_id].model_copy(
                    update={"condition_expression": expr}
                )

    return WorkflowGraph(nodes=tuple(nodes.values()), edges=tuple(edges.values()))
