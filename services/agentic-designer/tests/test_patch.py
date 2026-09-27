"""Patch operations are how Edit mode proposes changes the user can review."""

import pytest
from pydantic import ValidationError

from agentic_designer.graph import Edge, Node
from agentic_designer.patch import (
    AddNode,
    Connect,
    Disconnect,
    NodeChanges,
    PatchError,
    PatchOps,
    RemoveNode,
    SetCondition,
    UpdateNode,
    apply_patch,
)
from agentic_designer.validator import errors, validate
from fixtures import loan_approval


def test_insert_a_step_produces_a_valid_process():
    # The canonical edit: "add a compliance check after review".
    ops = [
        AddNode(node=Node(id="compliance", type="userTask", label="Compliance check", candidate_groups=("compliance",))),
        Disconnect(edge_id="f2"),
        Connect(edge=Edge(id="f2a", source="review", target="compliance")),
        Connect(edge=Edge(id="f2b", source="compliance", target="amount_check")),
    ]
    result = apply_patch(loan_approval(), ops)
    assert result.node("compliance") is not None
    assert validate(result) == []


def test_original_graph_is_never_modified():
    # Reject must restore exactly what was on the canvas.
    original = loan_approval()
    apply_patch(original, [RemoveNode(id="manager")])
    assert original == loan_approval()


def test_removing_a_node_removes_its_flows():
    result = apply_patch(loan_approval(), [RemoveNode(id="manager")])
    assert result.edge("f3") is None and result.edge("f5") is None
    # ...and the validator, not apply_patch, reports what that broke.
    assert result.edge("f4") is not None


@pytest.mark.parametrize(
    "ops, index",
    [
        ([UpdateNode(id="nope", changes=NodeChanges(label="x"))], 0),
        ([RemoveNode(id="manager"), RemoveNode(id="manager")], 1),
        ([AddNode(node=Node(id="f1", type="userTask", label="clashes with an edge id"))], 0),
        ([Connect(edge=Edge(id="fx", source="review", target="ghost"))], 0),
        ([Disconnect(edge_id="f99")], 0),
        ([SetCondition(edge_id="f99", condition_expression="${x}")], 0),
    ],
)
def test_bad_references_name_the_failing_op(ops, index):
    # The repair loop tells the model which op to fix, so the index matters.
    with pytest.raises(PatchError) as exc:
        apply_patch(loan_approval(), ops)
    assert exc.value.index == index


def test_update_changes_only_the_given_fields():
    result = apply_patch(loan_approval(), [UpdateNode(id="manager", changes=NodeChanges(label="Senior approval"))])
    manager = result.node("manager")
    assert manager.label == "Senior approval"
    assert manager.assignee == "${manager}"


def test_update_cannot_change_id_or_type():
    # Type changes must be remove + add so the node's flows are reconsidered.
    with pytest.raises(ValidationError):
        NodeChanges.model_validate({"type": "serviceTask"})
    with pytest.raises(ValidationError):
        NodeChanges.model_validate({"id": "other"})


def test_set_condition_can_clear_a_condition_and_the_validator_catches_it():
    result = apply_patch(loan_approval(), [SetCondition(edge_id="f3", condition_expression=None)])
    assert result.edge("f3").condition_expression is None
    assert {i.code for i in errors(validate(result))} == {"AD011"}


def test_ops_parse_from_model_json():
    # This is the shape a model's tool call arrives in.
    ops = PatchOps.validate_python(
        [
            {"op": "add_node", "node": {"id": "n1", "type": "userTask", "label": "New"}},
            {"op": "set_condition", "edgeId": "f3", "conditionExpression": "${a}"},
        ]
    )
    assert isinstance(ops[0], AddNode) and isinstance(ops[1], SetCondition)

    with pytest.raises(ValidationError):
        PatchOps.validate_python([{"op": "rename_everything"}])
