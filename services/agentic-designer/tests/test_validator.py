"""The validator is the gate between a model's proposal and the canvas.

A0's completion criterion: every malformed fixture is rejected for the
right reason. "Right reason" is checked strictly (the set of error codes
must be exactly the expected one) because the repair loop sends these codes
back to the model: a wrong or extra code sends it off fixing the wrong thing.
"""

import pytest

from agentic_designer.validator import errors, validate
from fixtures import BROKEN, WARNINGS, loan_approval


def test_valid_process_has_no_issues_at_all():
    # A clean graph must not produce warnings either, or Review mode would
    # nag about well-formed workflows and people would learn to ignore it.
    assert validate(loan_approval()) == []


@pytest.mark.parametrize("code", sorted(BROKEN))
def test_each_broken_graph_is_rejected_for_exactly_its_reason(code):
    found = {i.code for i in errors(validate(BROKEN[code]))}
    assert found == {code}


@pytest.mark.parametrize("code", sorted(WARNINGS))
def test_warnings_do_not_block_acceptance(code):
    issues = validate(WARNINGS[code])
    assert errors(issues) == []
    assert code in {i.code for i in issues if i.severity == "warning"}


def test_issues_point_at_the_offending_elements():
    # The SPA highlights these ids on the canvas; an issue that names the
    # wrong node is worse than no highlight.
    (issue,) = errors(validate(BROKEN["AD011"]))
    assert issue.node_ids == ("amount_check",)
    assert set(issue.edge_ids) == {"f3", "f4"}

    (dead_end,) = errors(validate(BROKEN["AD010"]))
    assert dead_end.node_ids == ("hold",)


def test_a_single_fallback_branch_is_allowed():
    # Exactly one unconditioned branch is the normal "otherwise" path of a
    # decision; only two or more is ambiguous.
    assert errors(validate(loan_approval())) == []


def test_whitespace_only_condition_counts_as_no_condition():
    from agentic_designer.graph import Edge
    from fixtures import with_changes

    g = with_changes(
        loan_approval(),
        replace_edges=[Edge(id="f3", source="amount_check", target="manager", condition_expression="   ")],
    )
    assert {i.code for i in errors(validate(g))} == {"AD011"}


def test_empty_graph_reports_missing_start_and_end():
    from agentic_designer.graph import WorkflowGraph

    assert {i.code for i in errors(validate(WorkflowGraph()))} == {"AD004", "AD006"}
