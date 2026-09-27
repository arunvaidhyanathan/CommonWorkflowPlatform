"""CMMN and DMN contracts (A4), anchored on the Designer's real sample files
(tests/data): if the Designer's adapters and these contracts drift apart,
the round-trip tests fail."""

import json
import pathlib

import pytest

from agentic_designer.canvas import CanvasConversionError
from agentic_designer.cmmn import CaseEdge, CaseGraph, CaseNode, case_from_canvas, case_to_canvas, validate_case
from agentic_designer.dmn import (
    Decision, DecisionModel, DmnInput, DmnOutput, DmnRule, from_dmn_model, to_dmn_model, validate_decisions,
)
from agentic_designer.validator import errors

DATA = pathlib.Path(__file__).parent / "data"
CASE_CANVAS = json.loads((DATA / "investigation_case.canvas.json").read_text())
DMN_MODEL = json.loads((DATA / "investigation_decisions.dmnmodel.json").read_text())


# --- real samples -------------------------------------------------------------------------

def test_real_cmmn_sample_converts_and_validates_clean():
    case = case_from_canvas(CASE_CANVAS)
    assert len(case.nodes) == 17 and len(case.edges) == 19
    assert validate_case(case) == []
    assert case_from_canvas(case_to_canvas(case)) == case


def test_real_dmn_sample_round_trips_exactly_including_table_ids():
    model = from_dmn_model(DMN_MODEL)
    assert [d.hit_policy for d in model.decisions] == ["COLLECT", "PRIORITY", "UNIQUE"]
    assert validate_decisions(model) == []
    assert to_dmn_model(model, DMN_MODEL) == DMN_MODEL


def test_new_decision_gets_a_table_id_and_keeps_file_metadata():
    model = from_dmn_model(DMN_MODEL)
    extra = Decision(id="Decision_New", name="New", hit_policy="FIRST",
                     inputs=(DmnInput(id="In_n", label="X", expression="x", type_ref="number"),),
                     outputs=(DmnOutput(id="Out_n", name="y", type_ref="string"),),
                     rules=(DmnRule(id="R_n", input_entries=("-",), output_entries=('"A"',)),))
    out = to_dmn_model(DecisionModel(decisions=model.decisions + (extra,)), DMN_MODEL)
    assert out["definitionsId"] == DMN_MODEL["definitionsId"]
    assert out["decisions"][-1]["decisionTable"]["id"] == "Decision_New_table"


# --- CMMN rules: each fixture breaks exactly one ------------------------------------------------

def case(*, extra_nodes=(), extra_edges=(), drop=(), replace=()):
    """A valid small case: review -> (sentry) -> decide, plus a milestone gate."""
    nodes = {n.id: n for n in (
        CaseNode(id="review", type="cmmnHumanTask", label="Review evidence"),
        CaseNode(id="s1", type="cmmnSentry", label="Evidence reviewed"),
        CaseNode(id="decide", type="cmmnHumanTask", label="Decide outcome"),
        CaseNode(id="done", type="cmmnMilestone", label="Decision made"),
        CaseNode(id="s2", type="cmmnSentry", label="Decided"),
    )}
    edges = {e.id: e for e in (
        CaseEdge(id="o1", source="review", target="s1", criterion_type="onPart", standard_event="complete"),
        CaseEdge(id="g1", source="s1", target="decide", criterion_type="entry"),
        CaseEdge(id="o2", source="decide", target="s2", criterion_type="onPart", standard_event="complete"),
        CaseEdge(id="g2", source="s2", target="done", criterion_type="entry"),
    )}
    for item in replace:
        (nodes if isinstance(item, CaseNode) else edges)[item.id] = item
    for d in drop:
        nodes.pop(d, None)
        edges.pop(d, None)
    return CaseGraph(nodes=tuple(nodes.values()) + tuple(extra_nodes), edges=tuple(edges.values()) + tuple(extra_edges))


def test_valid_case_is_clean():
    assert validate_case(case()) == []


CMMN_BROKEN = {
    "CD001": case(extra_nodes=[CaseNode(id="review", type="cmmnTask", label="Dup")]),
    "CD002": CaseGraph(nodes=(CaseNode(id="s", type="cmmnSentry", label="S", condition_expression="${x}"),)),
    "CD003": case(extra_edges=[CaseEdge(id="bad", source="ghost", target="s1", criterion_type="onPart", standard_event="complete")]),
    "CD004": case(replace=[CaseEdge(id="g1", source="decide", target="s1", criterion_type="entry")]),
    "CD005": case(replace=[CaseEdge(id="o1", source="review", target="s1", criterion_type="onPart")]),
    "CD006": case(replace=[CaseEdge(id="o1", source="review", target="s1", criterion_type="onPart", standard_event="occur")]),
    "CD007": case(replace=[CaseEdge(id="g1", source="s1", target="decide", criterion_type="entry", standard_event="complete")]),
    "CD008": case(drop=["o1"]),
    "CD010": case(replace=[CaseNode(id="decide", type="cmmnTask", label="Decide outcome", is_blocking=True)]),
}


@pytest.mark.parametrize("code", sorted(CMMN_BROKEN))
def test_each_broken_case_fails_for_exactly_its_reason(code):
    assert {i.code for i in errors(validate_case(CMMN_BROKEN[code]))} == {code}


def test_milestones_occur_they_do_not_complete():
    # A sentry waiting for a milestone to "complete" would never fire.
    ok = case(extra_nodes=[CaseNode(id="s3", type="cmmnSentry", label="After decision")],
              extra_edges=[CaseEdge(id="o3", source="done", target="s3", criterion_type="onPart", standard_event="occur"),
                           CaseEdge(id="g3", source="s3", target="review", criterion_type="exit")])
    assert validate_case(ok) == []


@pytest.mark.parametrize("code, graph", [
    ("CD009", case(drop=["g2"])),
    ("CD011", case(replace=[CaseNode(id="decide", type="cmmnHumanTask", label="")])),
])
def test_cmmn_warnings_do_not_block(code, graph):
    issues = validate_case(graph)
    assert errors(issues) == [] and code in {i.code for i in issues}


def test_unsupported_canvas_node_fails_loudly():
    canvas = case_to_canvas(case())
    canvas["nodes"].append({"id": "x", "type": "userTask", "position": {"x": 0, "y": 0}, "data": {"label": "BPMN task"}})
    with pytest.raises(CanvasConversionError):
        case_from_canvas(canvas)


# --- DMN rules -----------------------------------------------------------------------------------

def decision(**overrides):
    base = dict(
        id="D1", name="Risk level", hit_policy="UNIQUE",
        inputs=(DmnInput(id="I1", label="Score", expression="score", type_ref="number"),),
        outputs=(DmnOutput(id="O1", name="level", type_ref="string"),),
        rules=(DmnRule(id="R1", input_entries=(">= 70",), output_entries=('"High"',)),
               DmnRule(id="R2", input_entries=("< 70",), output_entries=('"Low"',))),
    )
    base.update(overrides)
    return DecisionModel(decisions=(Decision(**base),))


def test_valid_decision_is_clean():
    assert validate_decisions(decision()) == []


DMN_BROKEN = {
    "DM001": decision(rules=(DmnRule(id="I1", input_entries=(">= 70",), output_entries=('"High"',)),)),
    "DM002": DecisionModel(),
    "DM003": decision(outputs=(), rules=()),
    "DM004": decision(rules=(DmnRule(id="R1", input_entries=(">= 70", "-"), output_entries=('"High"',)),)),
    "DM005": decision(aggregation="SUM"),
    "DM006": decision(rules=(DmnRule(id="R1", input_entries=(">= 70",), output_entries=(" ",)),)),
    "DM007": decision(inputs=(DmnInput(id="I1", label="Score", expression="  ", type_ref="number"),)),
    "DM008": decision(outputs=(DmnOutput(id="O1", name="level", type_ref="string"), DmnOutput(id="O2", name="level", type_ref="string")),
                      rules=(DmnRule(id="R1", input_entries=("-",), output_entries=('"A"', '"B"')),)),
    "DM009": decision(rules=(DmnRule(id="R1", input_entries=(">= 70",), output_entries=('"High"',)),
                             DmnRule(id="R2", input_entries=(">=  70",), output_entries=('"Very high"',)))),
    "DM012": decision(rules=(DmnRule(id="R1", input_entries=("",), output_entries=('"High"',)),)),
}


@pytest.mark.parametrize("code", sorted(DMN_BROKEN))
def test_each_broken_decision_fails_for_exactly_its_reason(code):
    assert {i.code for i in errors(validate_decisions(DMN_BROKEN[code]))} == {code}


def test_identical_rules_are_fine_when_the_hit_policy_allows_several_matches():
    same = (DmnRule(id="R1", input_entries=(">= 70",), output_entries=('"High"',)),
            DmnRule(id="R2", input_entries=(">= 70",), output_entries=('"Flag"',)))
    assert validate_decisions(decision(hit_policy="COLLECT", rules=same)) == []


@pytest.mark.parametrize("code, model", [
    ("DM010", decision(rules=(DmnRule(id="R1", input_entries=("-",), output_entries=("High",)),))),  # unquoted string
    ("DM011", decision(rules=())),
])
def test_dmn_warnings_do_not_block(code, model):
    issues = validate_decisions(model)
    assert errors(issues) == [] and code in {i.code for i in issues}


def test_dmn_issues_point_at_the_decision_and_rule():
    (issue,) = errors(validate_decisions(DMN_BROKEN["DM009"]))
    assert issue.node_ids == ("D1", "R1", "R2")
