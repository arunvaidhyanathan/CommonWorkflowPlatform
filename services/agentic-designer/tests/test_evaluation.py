"""The evaluation harness (A5) must score honestly: a check that can't be
evaluated or a case that produced nothing counts as a failure, never as a
pass, and decision tables are judged by what they actually decide."""

import asyncio
import json

import pytest

from agentic_designer.dmn import Decision, DmnInput, DmnOutput, DmnRule
from agentic_designer.evaluation import harness
from agentic_designer.evaluation.cases import (
    Case, decides, edit_cases, generate_cases, has_condition, investigation_decisions, loan_approval, sentry_waits_for,
)
from agentic_designer.evaluation.feel import HitPolicyViolation, Unsupported, evaluate, matches
from agentic_designer.llm import ProviderError
from stubs import ScriptedProvider

SAMPLE = investigation_decisions()


# --- FEEL -----------------------------------------------------------------------------------

@pytest.mark.parametrize("test, value, expected", [
    ("-", "anything", True),
    ('"Trading"', "Trading", True),
    ('"Trading"', "Compliance", False),
    (">= 3", 3, True),
    ("< 3", 3, False),
    ("[650..749]", 749, True),
    ("[650..749)", 749, False),
    ("]1..5[", 1, False),
    ('"fraud","embezzlement"', "embezzlement", True),
    ("not(< 3)", 5, True),
    ("[650..749]", "700", False),  # a string never matches a numeric range
])
def test_unary_tests(test, value, expected):
    assert matches(test, value) is expected


def test_the_designers_sample_decides_what_its_rules_say():
    # Worked out by hand from the rules in investigation-decisions.dmn.
    risk = SAMPLE.decisions[0]  # COLLECT + SUM
    assert evaluate(risk, {"department": "Trading", "priorIncidentCount": 3}) == 25
    assert evaluate(risk, {"department": "Trading", "priorIncidentCount": 6}) == 45  # two rules add up
    # The gap Review reported in A4, confirmed by execution: nothing matches.
    assert evaluate(risk, {"department": "HR", "priorIncidentCount": 1}) is None


def test_unique_with_two_matches_is_a_violation_not_an_answer():
    d = Decision(id="D", name="D", hit_policy="UNIQUE",
                 inputs=(DmnInput(id="I", label="x", expression="x", type_ref="number"),),
                 outputs=(DmnOutput(id="O", name="y", type_ref="string"),),
                 rules=(DmnRule(id="R1", input_entries=(">= 1",), output_entries=('"a"',)),
                        DmnRule(id="R2", input_entries=(">= 2",), output_entries=('"b"',))))
    with pytest.raises(HitPolicyViolation):
        evaluate(d, {"x": 5})


def test_unsupported_expressions_are_not_guessed():
    with pytest.raises(Unsupported):
        matches("date(\"2026-01-01\")", "2026-01-01")


# --- checks ------------------------------------------------------------------------------------

def test_decides_fails_visibly_when_the_table_renames_an_input():
    check = decides({"creditScore": 780, "dti": 0.2}, "riskTier", "Low")
    renamed = investigation_decisions()  # has no creditScore input at all
    name, passed, detail = check(renamed, None)
    assert not passed and "can't evaluate" in detail


def test_condition_check_ignores_formatting():
    assert has_condition("10000")(loan_approval(), None)[1]  # ${amount > 10000}
    assert not has_condition("50000")(loan_approval(), None)[1]


def test_sentry_check_needs_every_item():
    from agentic_designer.cmmn import CaseEdge, CaseGraph, CaseNode
    case = CaseGraph(
        nodes=(CaseNode(id="e", type="cmmnHumanTask", label="Gather evidence"),
               CaseNode(id="i", type="cmmnHumanTask", label="Interview customer"),
               CaseNode(id="s", type="cmmnSentry", label="Both done")),
        edges=(CaseEdge(id="a", source="e", target="s", criterion_type="onPart", standard_event="complete"),),
    )
    assert not sentry_waits_for("evidence", "interview")(case, None)[1]  # only one of the two


def test_every_case_check_carries_a_label():
    assert all(hasattr(k, "label") for c in generate_cases() + edit_cases() for k in c.checks)


# --- running cases -------------------------------------------------------------------------------

def run(provider, case):
    return asyncio.run(harness.run_case(provider, case, backoff_s=0))


def test_valid_case_scores_its_checks_and_meters_tokens():
    case = Case("t", "generate", "BPMN", "Loan with manager approval over 10k",
                (has_condition("10000"), has_condition("50000")))
    r = run(ScriptedProvider(loan_approval().model_dump_json(by_alias=True)), case)
    assert (r.outcome, r.checks_passed, len(r.checks)) == ("valid", 1, 2)
    assert (r.attempts, r.calls, r.input_tokens) == (1, 1, 1000)


def test_a_case_with_no_valid_result_fails_every_check():
    # Otherwise a model that never produces anything would score 0/0 = "no misses".
    case = Case("t", "generate", "BPMN", "Loan", (has_condition("10000"),))
    r = run(ScriptedProvider(*["{}"] * 3), case)
    assert r.outcome == "failed"
    assert r.checks == [{"name": "condition mentioning 10000", "passed": False, "detail": "no valid result"}]


def test_rate_limited_case_is_retried_then_scored():
    class Throttled(ScriptedProvider):
        def __init__(self, *a):
            super().__init__(*a)
            self.hits = 0

        async def generate_json(self, system, turns, schema):
            self.hits += 1
            if self.hits == 1:
                raise ProviderError("429", kind="rate_limited")
            return await super().generate_json(system, turns, schema)

    case = Case("t", "generate", "BPMN", "Loan", (has_condition("10000"),))
    r = run(Throttled(loan_approval().model_dump_json(by_alias=True)), case)
    assert r.outcome == "valid" and r.checks_passed == 1


def test_unpriced_calls_leave_the_case_cost_unknown_not_zero():
    case = Case("t", "generate", "BPMN", "Loan", ())
    r = run(ScriptedProvider(loan_approval().model_dump_json(by_alias=True)), case)
    assert r.cost_usd is None  # the scripted model has no price


def test_dmn_edit_case_is_judged_by_execution():
    (case,) = [c for c in edit_cases() if c.id == "edit-dmn-operations"]
    after = json.loads(SAMPLE.model_dump_json(by_alias=True, exclude_none=True))
    after["decisions"][0]["rules"].append(
        {"id": "Rule_ops", "inputEntries": ['"Operations"', ">= 2"], "outputEntries": ["12"]})
    r = run(ScriptedProvider(json.dumps(after)), case)
    assert r.outcome == "valid" and r.checks_passed == len(r.checks) == 2


def test_summary_counts_by_mode_and_notation():
    a = harness.CaseResult("a", "generate", "BPMN", "valid", attempts=1, seconds=10,
                           checks=[{"name": "x", "passed": True, "detail": ""}], cost_usd="0.01")
    b = harness.CaseResult("b", "generate", "BPMN", "failed", attempts=3, seconds=30,
                           checks=[{"name": "y", "passed": False, "detail": ""}], cost_usd=None)
    s = harness.summarize([a, b])["generate/BPMN"]
    assert (s["valid"], s["checks_passed"], s["checks_total"], s["mean_attempts"]) == (1, 1, 2, 2.0)
    assert s["cost_usd"] is None  # one case unpriced: the group total isn't known


def test_review_expectation_matching():
    from agentic_designer.review import Finding
    found = [Finding("ai", "warning", "rule_gap", "gap", ("Decision_RiskScoreAggregation",))]
    assert harness.review_caught(found, {"source": "ai", "categories": ["rule_gap"], "node": "Decision_RiskScoreAggregation"})
    assert not harness.review_caught(found, {"source": "ai", "categories": ["hit_policy"], "node": None})


def test_provider_error_fails_every_check_too():
    class Down(ScriptedProvider):
        async def generate_json(self, system, turns, schema):
            raise ProviderError("could not be reached")

    case = Case("t", "generate", "BPMN", "Loan", (has_condition("10000"), has_condition("5000")))
    r = run(Down(), case)
    assert r.outcome == "error" and [c["passed"] for c in r.checks] == [False, False]


def test_a_check_that_crashes_fails_itself_without_stopping_the_run():
    from agentic_designer.evaluation.cases import _labelled

    @_labelled("explodes")
    def broken(model, before):
        raise KeyError("oops")

    case = Case("t", "generate", "BPMN", "Loan", (broken, has_condition("10000")))
    r = run(ScriptedProvider(loan_approval().model_dump_json(by_alias=True)), case)
    assert [c["passed"] for c in r.checks] == [False, True]
    assert "check error" in r.checks[0]["detail"]


def test_condition_check_reads_cmmn_sentry_conditions():
    from agentic_designer.cmmn import CaseGraph, CaseNode

    case = CaseGraph(nodes=(CaseNode(id="s", type="cmmnSentry", label="Fraud?", condition_expression="${fraudSuspected}"),))
    assert has_condition("fraudSuspected")(case, None)[1]


def test_a_step_is_recognised_by_who_does_it():
    from agentic_designer.evaluation.cases import has_node
    from agentic_designer.graph import Node, WorkflowGraph

    g = WorkflowGraph(nodes=(Node(id="a", type="userTask", label="Approve loan", candidate_groups=("managers",)),))
    assert has_node("userTask", "manager")(g, None)[1]


# --- grounding cases ------------------------------------------------------------------------------

class _KeywordEmbedder:
    """Deterministic stand-in: similarity by shared keywords."""
    name, model, key_alias = "kw", "kw-embed", "KW"
    WORDS = ("loan", "credit", "committee", "contract", "hire")

    async def embed(self, texts, kind):
        return [[1.0 + t.lower().count(w) for w in self.WORDS] for t in texts], 0


def test_grounding_case_uses_the_closest_tenant_workflow():
    from agentic_designer.evaluation.cases import grounding_cases

    (case, _) = grounding_cases()
    provider = ScriptedProvider(loan_approval().model_dump_json(by_alias=True))
    r = asyncio.run(harness.run_case(provider, case, backoff_s=0, embedder=_KeywordEmbedder()))
    assert r.grounded_on[0] == "Mortgage approval"
    assert "<tenant_examples>" in provider.calls[0][0].text and "credit_committee" in provider.calls[0][0].text


def test_grounding_case_without_an_embedder_fails_instead_of_running_ungrounded():
    from agentic_designer.evaluation.cases import grounding_cases

    (case, _) = grounding_cases()
    r = asyncio.run(harness.run_case(ScriptedProvider(), case, backoff_s=0))
    assert r.outcome == "error" and not any(c["passed"] for c in r.checks)


def test_all_empty_replies_count_as_no_answer_not_a_wrong_answer():
    class Silent(ScriptedProvider):
        async def generate_json(self, system, turns, schema):
            raise ProviderError("empty", kind="empty")

    case = Case("t", "generate", "BPMN", "Loan", (has_condition("10000"),))
    r = run(Silent(), case)
    assert (r.outcome, r.attempts, r.empty_replies) == ("failed", 3, 3)
    assert harness.summarize([r])["all"]["no_answer"] == 1


def test_out_of_credit_is_not_retried():
    # Waiting doesn't refill an account; retrying would just burn time.
    class Broke(ScriptedProvider):
        def __init__(self):
            super().__init__()
            self.hits = 0

        async def generate_json(self, system, turns, schema):
            self.hits += 1
            raise ProviderError("out of credit", kind="rate_limited", retryable=False)

    provider = Broke()
    r = asyncio.run(harness.run_case(provider, Case("t", "generate", "BPMN", "Loan", (has_condition("10000"),)), backoff_s=0))
    assert r.outcome == "error" and provider.hits == 1
