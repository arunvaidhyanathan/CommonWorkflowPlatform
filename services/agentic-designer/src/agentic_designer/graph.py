"""The typed workflow graph the model is allowed to produce.

Field names serialize in camelCase so the vocabulary matches the Designer
SPA's ``NodeData`` (Designer/src/store/useWorkbenchStore.ts) one to one.
``extra="forbid"`` everywhere: a model inventing an attribute is a schema
error, not something silently dropped.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

# BPMN ids must be XML NCNames; this is the practical subset the Designer
# itself generates and the BPMN adapter round-trips.
ID_PATTERN = r"^[A-Za-z_][A-Za-z0-9_.-]*$"

# The Designer's BPMN palette (Designer/src/nodes/nodeTypes.ts) minus:
# - boundaryEvent: needs an attachedTo host, which the canvas format can't
#   express yet;
# - genericNode: the Designer's fallback for unknown BPMN elements, not
#   something to author on purpose.
NodeType = Literal[
    "startEvent",
    "endEvent",
    "intermediateEvent",
    "userTask",
    "serviceTask",
    "businessRuleTask",
    "callActivity",
    "subProcess",
    "exclusiveGateway",
    "parallelGateway",
    "inclusiveGateway",
]

ACTIVITY_TYPES: frozenset[str] = frozenset(
    {"userTask", "serviceTask", "businessRuleTask", "callActivity", "subProcess"}
)
GATEWAY_TYPES: frozenset[str] = frozenset(
    {"exclusiveGateway", "parallelGateway", "inclusiveGateway"}
)

# Which optional fields mean something for which node type. Anything else
# set on a node is a validator error (AD014), because the BPMN adapter would
# either drop it or write an attribute Flowable ignores.
FIELD_APPLICABILITY: dict[str, frozenset[str]] = {
    "assignee": frozenset({"userTask"}),
    "candidateGroups": frozenset({"userTask"}),
    "formKey": frozenset({"userTask", "startEvent"}),
    "delegateExpression": frozenset({"serviceTask"}),
}


class _Model(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        frozen=True,
    )


class Node(_Model):
    id: str = Field(pattern=ID_PATTERN)
    type: NodeType
    label: str = ""
    documentation: str | None = None
    assignee: str | None = None
    candidate_groups: tuple[str, ...] | None = None
    delegate_expression: str | None = None
    form_key: str | None = None


class Edge(_Model):
    id: str = Field(pattern=ID_PATTERN)
    source: str
    target: str
    label: str = ""
    condition_expression: str | None = None


class WorkflowGraph(_Model):
    nodes: tuple[Node, ...] = ()
    edges: tuple[Edge, ...] = ()

    def node(self, node_id: str) -> Node | None:
        return next((n for n in self.nodes if n.id == node_id), None)

    def edge(self, edge_id: str) -> Edge | None:
        return next((e for e in self.edges if e.id == edge_id), None)
