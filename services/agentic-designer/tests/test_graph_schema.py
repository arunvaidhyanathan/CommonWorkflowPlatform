"""The schema is the first line of defense against a model making things up."""

import pytest
from pydantic import ValidationError

from agentic_designer.graph import Node, WorkflowGraph


def test_invented_attributes_are_rejected_not_dropped():
    # Silently dropping an unknown field would hide that the model
    # misunderstood the contract; the repair loop needs to see it.
    with pytest.raises(ValidationError):
        Node.model_validate({"id": "t1", "type": "userTask", "label": "x", "priority": "high"})


@pytest.mark.parametrize("node_type", ["boundaryEvent", "genericNode", "task", "cmmnHumanTask"])
def test_node_types_outside_the_authorable_bpmn_set_are_rejected(node_type):
    with pytest.raises(ValidationError):
        Node.model_validate({"id": "n1", "type": node_type})


@pytest.mark.parametrize("bad_id", ["1task", "has space", "", "a/b"])
def test_ids_must_be_valid_bpmn_ids(bad_id):
    # These end up as XML ids in the BPMN file; an invalid one breaks
    # export and Flowable deployment, far from where it was introduced.
    with pytest.raises(ValidationError):
        Node.model_validate({"id": bad_id, "type": "userTask"})


def test_json_uses_the_designers_camel_case_field_names():
    node = Node.model_validate(
        {"id": "t1", "type": "userTask", "candidateGroups": ["ops"], "formKey": "f"}
    )
    dumped = node.model_dump(by_alias=True, exclude_none=True)
    assert dumped["candidateGroups"] == ("ops",)
    assert dumped["formKey"] == "f"


def test_graph_json_round_trips():
    from fixtures import loan_approval

    g = loan_approval()
    assert WorkflowGraph.model_validate_json(g.model_dump_json(by_alias=True)) == g
