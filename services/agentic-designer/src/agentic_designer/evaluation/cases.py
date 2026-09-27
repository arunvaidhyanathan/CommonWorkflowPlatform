"""Evaluation cases: what we ask for, and how we tell whether we got it.

Each check returns (name, passed, detail). Checks look at what matters to a
process owner, not at exact shapes, since many correct models exist:
- BPMN / CMMN: the steps, conditions and gates the request implies;
- DMN: the generated table is *executed* on test inputs and its answers
  compared with the ones the description defines;
- Edit: the asked-for change is there and nothing else was lost;
- Review: the planted defect is reported (tests/review_samples.py style).
"""

import json
import pathlib
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from ..cmmn import case_from_canvas
from ..dmn import from_dmn_model
from ..graph import Edge, Node, WorkflowGraph
from .feel import HitPolicyViolation, Unsupported, evaluate

Check = Callable[[Any, Any], tuple[str, bool, str]]


def _labelled(label: str):
    """Attach the check's name, so a case with no valid result can still
    list (and fail) each of its checks."""
    def wrap(check):
        check.label = label
        return check
    return wrap
DATA = pathlib.Path(__file__).resolve().parents[3] / "tests" / "data"


@dataclass(frozen=True)
class Case:
    id: str
    mode: str  # generate | edit | review
    spec: str  # BPMN | CMMN | DMN
    text: str  # description, instruction, or review focus ("" for none)
    checks: tuple[Check, ...] = ()
    base: Any = None  # the model being edited or reviewed
    expect: dict = field(default_factory=dict)  # review: {"source", "code"|"category", "node"}
    # Grounding: the tenant's existing workflows, (name, Designer-format graph).
    # When set, the harness grounds the request in them with a real embedder.
    tenant: tuple = ()


def _label(n) -> str:
    return (n.label or "").lower()


def _who_and_what(n) -> str:
    """Label plus who does it: "Approve loan" by group "managers" is a manager step."""
    parts = [n.label or "", getattr(n, "assignee", None) or "", *(getattr(n, "candidate_groups", None) or ())]
    return " ".join(parts).lower()


def _flat(s: str) -> str:
    return re.sub(r"[\s,_]", "", s.lower())


# --- BPMN / CMMN checks ------------------------------------------------------------------

def has_node(node_type: str, *words: str) -> Check:
    @_labelled(f"{node_type} mentioning {'/'.join(words) or 'anything'}")
    def check(model, _before):
        ok = any(n.type == node_type and all(w in _who_and_what(n) for w in words) for n in model.nodes)
        return f"{node_type} mentioning {'/'.join(words) or 'anything'}", ok, ""
    return check


def uses_delegate(word: str) -> Check:
    @_labelled(f"a delegate expression mentioning {word}")
    def check(model, _before):
        found = [n.delegate_expression for n in model.nodes if getattr(n, "delegate_expression", None)]
        return f"a delegate expression mentioning {word}", any(word.lower() in d.lower() for d in found), ", ".join(found)
    return check


def has_condition(*alternatives: str) -> Check:
    @_labelled(f"condition mentioning {' or '.join(alternatives)}")
    def check(model, _before):
        # BPMN conditions sit on flows; CMMN conditions sit on sentries.
        conds = [_flat(getattr(x, "condition_expression", None) or "") for x in (*model.edges, *model.nodes)]
        ok = any(any(_flat(a) in c for a in alternatives) for c in conds)
        return f"condition mentioning {' or '.join(alternatives)}", ok, "; ".join(c for c in conds if c)[:160]
    return check


def sentry_waits_for(*words_per_item: str) -> Check:
    """A sentry with onParts from items matching every word (an AND gate)."""
    @_labelled(f"a sentry waits for {' and '.join(words_per_item)}")
    def check(model, _before):
        labels = {n.id: _label(n) for n in model.nodes}
        for s in (n for n in model.nodes if n.type == "cmmnSentry"):
            sources = [labels.get(e.source, "") for e in model.edges if e.target == s.id and e.criterion_type == "onPart"]
            if all(any(w in src for src in sources) for w in words_per_item):
                return f"a sentry waits for {' and '.join(words_per_item)}", True, s.label
        return f"a sentry waits for {' and '.join(words_per_item)}", False, ""
    return check


def gated_by_new_sentry(target_id: str, *words: str) -> Check:
    """Edit check: the target now has an entry from a sentry fed by a new item mentioning ``words``."""
    @_labelled(f"{target_id} waits for a new {'/'.join(words)} item")
    def check(model, before):
        old_ids = {n.id for n in before.nodes}
        labels = {n.id: _label(n) for n in model.nodes}
        for e in model.edges:
            if e.criterion_type == "entry" and e.target == target_id:
                feeders = [x.source for x in model.edges if x.target == e.source and x.criterion_type == "onPart"]
                if any(f not in old_ids and all(w in labels.get(f, "") for w in words) for f in feeders):
                    return f"{target_id} waits for a new {'/'.join(words)} item", True, ""
        return f"{target_id} waits for a new {'/'.join(words)} item", False, ""
    return check


def keeps_ids(*ids: str) -> Check:
    @_labelled("kept the untouched nodes")
    def check(model, _before):
        present = {n.id for n in model.nodes}
        lost = [i for i in ids if i not in present]
        return "kept the untouched nodes", not lost, f"lost {lost}" if lost else ""
    return check


def lacks_node_mentioning(word: str) -> Check:
    @_labelled(f"no node mentioning {word}")
    def check(model, _before):
        ok = not any(word in _label(n) for n in model.nodes)
        return f"no node mentioning {word}", ok, ""
    return check


# --- DMN checks: execute the table ------------------------------------------------------------

def decides(inputs: dict[str, Any], output: str, expected: Any, decision_index: int = 0) -> Check:
    """Run decision ``decision_index`` on ``inputs`` and compare ``output``.
    Input names must match the table's input expressions: the case text
    names them, so a table that renames them fails visibly."""
    @_labelled(f"{inputs} -> {output}={expected!r}")
    def check(model, _before):
        name = f"{inputs} -> {output}={expected!r}"
        if len(model.decisions) <= decision_index:
            return name, False, "decision missing"
        decision = model.decisions[decision_index]
        try:
            got = evaluate(decision, inputs)
        except Unsupported as exc:
            return name, False, f"can't evaluate: {exc}"
        except HitPolicyViolation as exc:
            return name, False, str(exc)
        if isinstance(got, dict):
            got = got.get(output)
        return name, got == expected, f"got {got!r}"
    return check


# --- fixtures ----------------------------------------------------------------------------------

def loan_approval() -> WorkflowGraph:
    return WorkflowGraph(
        nodes=(
            Node(id="start", type="startEvent", label="Application received"),
            Node(id="review", type="userTask", label="Review application", candidate_groups=("underwriters",)),
            Node(id="amount_check", type="exclusiveGateway", label="Amount over 10k?"),
            Node(id="manager", type="userTask", label="Manager approval", assignee="${manager}"),
            Node(id="merge", type="exclusiveGateway"),
            Node(id="disburse", type="serviceTask", label="Disburse funds", delegate_expression="${disburseDelegate}"),
            Node(id="end", type="endEvent", label="Done"),
        ),
        edges=(
            Edge(id="f1", source="start", target="review"),
            Edge(id="f2", source="review", target="amount_check"),
            Edge(id="f3", source="amount_check", target="manager", label="yes", condition_expression="${amount > 10000}"),
            Edge(id="f4", source="amount_check", target="merge", label="no"),
            Edge(id="f5", source="manager", target="merge"),
            Edge(id="f6", source="merge", target="disburse"),
            Edge(id="f7", source="disburse", target="end"),
        ),
    )


def investigation_case():
    return case_from_canvas(json.loads((DATA / "investigation_case.canvas.json").read_text()))


def investigation_decisions():
    return from_dmn_model(json.loads((DATA / "investigation_decisions.dmnmodel.json").read_text()))


# --- the cases ----------------------------------------------------------------------------------

def generate_cases() -> list[Case]:
    return [
        Case("gen-bpmn-loan", "generate", "BPMN",
             "Loan application. An underwriter reviews the application. If the amount is over 10,000, a manager must approve it; "
             "if the manager rejects it, the applicant is notified and the process ends. Approved or small loans are disbursed by "
             "the system, then the applicant is notified.",
             (has_node("userTask", "manager"), has_condition("10000", "10k"), has_node("serviceTask", "disburs"))),
        Case("gen-bpmn-parallel-onboarding", "generate", "BPMN",
             "Employee onboarding. HR prepares the contract while, at the same time, IT sets up the laptop and accounts. "
             "When both are done, the manager welcomes the new employee.",
             (has_node("parallelGateway"), has_node("userTask", "contract"), has_node("userTask", "welcome"))),
        Case("gen-bpmn-expense", "generate", "BPMN",
             "Expense claim: the employee submits a claim, their line manager approves it, claims over 5,000 also need finance "
             "approval, then payroll pays it.",
             (has_condition("5000", "5k"), has_node("userTask", "finance"))),
        Case("gen-cmmn-fraud", "generate", "CMMN",
             "Fraud investigation case: an analyst gathers evidence and interviews the customer; once both are done a senior "
             "investigator decides. If fraud is confirmed, the account is frozen; the case closes after a decision is recorded.",
             (has_node("cmmnHumanTask", "evidence"), has_node("cmmnHumanTask", "interview"),
              sentry_waits_for("evidence", "interview"))),
        Case("gen-cmmn-claim", "generate", "CMMN",
             "Insurance claim case: an adjuster assesses the damage. If fraud is suspected (the variable fraudSuspected is true), "
             "a special investigations review becomes available. The claim is settled once the assessment is complete.",
             (has_node("cmmnHumanTask", "assess"), has_condition("fraudSuspected"))),
        Case("gen-dmn-loan-tier", "generate", "DMN",
             "Loan risk tier. Inputs: creditScore (number) and dti (number, debt-to-income ratio). Output: riskTier (string). "
             "creditScore >= 750 and dti < 0.35 is \"Low\"; otherwise creditScore between 650 and 749, or dti between 0.35 and "
             "0.45, is \"Medium\"; everything else is \"High\".",
             (decides({"creditScore": 780, "dti": 0.2}, "riskTier", "Low"),
              decides({"creditScore": 700, "dti": 0.5}, "riskTier", "Medium"),
              decides({"creditScore": 800, "dti": 0.4}, "riskTier", "Medium"),
              decides({"creditScore": 600, "dti": 0.6}, "riskTier", "High"))),
        Case("gen-dmn-shipping", "generate", "DMN",
             "Shipping cost. Inputs: zone (string: \"domestic\" or \"international\") and weightKg (number). Output: cost (number). "
             "Domestic parcels up to 2 kg cost 5, heavier domestic parcels cost 12. International parcels up to 2 kg cost 20, "
             "heavier international parcels cost 45.",
             (decides({"zone": "domestic", "weightKg": 1}, "cost", 5),
              decides({"zone": "domestic", "weightKg": 5}, "cost", 12),
              decides({"zone": "international", "weightKg": 2}, "cost", 20),
              decides({"zone": "international", "weightKg": 10}, "cost", 45))),
    ]


def edit_cases() -> list[Case]:
    loan, case, dmn = loan_approval(), investigation_case(), investigation_decisions()
    return [
        Case("edit-bpmn-compliance", "edit", "BPMN",
             "Loans over 50,000 also need a compliance review by the compliance team, after the manager approval.",
             (has_node("userTask", "compliance"), has_condition("50000", "50k"),
              keeps_ids("review", "amount_check", "manager", "disburse")), base=loan),
        Case("edit-bpmn-remove-manager", "edit", "BPMN",
             "Remove the manager approval step; the amount check should go straight to disbursement.",
             (lacks_node_mentioning("manager"), keeps_ids("review", "disburse")), base=loan),
        Case("edit-cmmn-legal", "edit", "CMMN",
             "Before the determination review, legal must review the case: the determination review can only start once a "
             "legal review is complete.",
             (gated_by_new_sentry("PI_Determination", "legal"), keeps_ids("PI_Intake", "PI_Evidence", "PI_Interview")), base=case),
        Case("edit-dmn-operations", "edit", "DMN",
             "In Risk Score Aggregation, add a rule: department \"Operations\" with 2 or more prior incidents scores 12 points.",
             (decides({"department": "Operations", "priorIncidentCount": 3}, "riskPoints", 12),
              decides({"department": "Trading", "priorIncidentCount": 6}, "riskPoints", 45)), base=dmn),
    ]


def review_cases() -> list[Case]:
    """Real defects in the Designer's own sample files, found in A4 and
    confirmed independently (the rule gap by executing the table: department
    "HR" with 1 incident matches no rule). The seeded BPMN defects from A3
    are added by scripts/eval.py from tests/review_samples.py."""
    return [
        Case("review-dmn-sample-gap", "review", "DMN", "", base=investigation_decisions(),
             expect={"source": "ai", "categories": ["rule_gap"], "node": "Decision_RiskScoreAggregation"}),
        Case("review-dmn-sample-priority", "review", "DMN", "", base=investigation_decisions(),
             expect={"source": "ai", "categories": ["hit_policy"], "node": "Decision_SanctionSeverity"}),
        Case("review-cmmn-sample", "review", "CMMN", "", base=investigation_case(),
             expect={"source": "ai", "categories": ["missing_path", "ordering", "incomplete_conditions"], "node": None}),
    ]


def house_mortgage():
    """A tenant workflow with distinctive conventions to pick up."""
    from ..canvas import to_canvas

    g = WorkflowGraph(
        nodes=(
            Node(id="start", type="startEvent", label="Mortgage application received"),
            Node(id="assess", type="userTask", label="Assess affordability", candidate_groups=("credit_officers",)),
            Node(id="size", type="exclusiveGateway", label="Loan above committee limit?"),
            Node(id="committee", type="userTask", label="Credit committee decision", candidate_groups=("credit_committee",)),
            Node(id="join", type="exclusiveGateway"),
            Node(id="payout", type="serviceTask", label="Pay out mortgage", delegate_expression="${loanCore.disburse}"),
            Node(id="end", type="endEvent", label="Mortgage paid out"),
        ),
        edges=(
            Edge(id="f1", source="start", target="assess"),
            Edge(id="f2", source="assess", target="size"),
            Edge(id="f3", source="size", target="committee", label="yes", condition_expression="${loanAmount > 250000}"),
            Edge(id="f4", source="size", target="join", label="no"),
            Edge(id="f5", source="committee", target="join"),
            Edge(id="f6", source="join", target="payout"),
            Edge(id="f7", source="payout", target="end"),
        ),
    )
    return to_canvas(g)


def house_onboarding():
    from ..canvas import to_canvas

    g = WorkflowGraph(
        nodes=(Node(id="s", type="startEvent", label="New hire"),
               Node(id="t", type="userTask", label="Prepare contract", candidate_groups=("hr_team",)),
               Node(id="e", type="endEvent", label="Onboarded")),
        edges=(Edge(id="a", source="s", target="t"), Edge(id="b", source="t", target="e")),
    )
    return to_canvas(g)


GROUNDED_REQUEST = ("Car loan: a credit officer checks the application; loans above the committee limit need the credit "
                    "committee to approve them; then the system pays the loan out.")
CONVENTION_CHECKS = (has_node("userTask", "credit_committee"), has_condition("loanAmount"), uses_delegate("loanCore"))


def grounding_cases() -> list[Case]:
    """The same request with and without the tenant's workflows: grounding
    should make the tenant's own names (credit_committee, loanAmount,
    loanCore) show up; without it the model has no way to know them."""
    tenant = (("Mortgage approval", house_mortgage()), ("Employee onboarding", house_onboarding()))
    return [
        Case("ground-bpmn-with-tenant", "generate", "BPMN", GROUNDED_REQUEST, CONVENTION_CHECKS, tenant=tenant),
        Case("ground-bpmn-baseline", "generate", "BPMN", GROUNDED_REQUEST, CONVENTION_CHECKS),
    ]
