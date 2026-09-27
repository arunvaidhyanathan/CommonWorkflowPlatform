"""Generate, Edit and Review for CMMN and DMN (A4): the same guarantees as
BPMN, through the spec interface."""

import asyncio
import json
import pathlib

from fastapi.testclient import TestClient

from agentic_designer.app import create_app
from agentic_designer.cmmn import case_from_canvas
from agentic_designer.dmn import from_dmn_model
from agentic_designer.edit import edit_workflow
from agentic_designer.generate import event_payload, generate_workflow
from agentic_designer.review import review_workflow
from agentic_designer.specs import CMMN, DMN
from stubs import LocalVerifier, RecordingSink, ScriptedProvider

DATA = pathlib.Path(__file__).parent / "data"
CASE_CANVAS = json.loads((DATA / "investigation_case.canvas.json").read_text())
DMN_MODEL = json.loads((DATA / "investigation_decisions.dmnmodel.json").read_text())
CASE = case_from_canvas(CASE_CANVAS)
DECISIONS = from_dmn_model(DMN_MODEL)


def collect(gen):
    async def go():
        return [e async for e in gen]
    return asyncio.run(go())


def dumps(model):
    return model.model_dump_json(by_alias=True, exclude_none=True)


# --- Generate ---------------------------------------------------------------------------------

def test_generate_case_uses_the_cmmn_prompt_schema_and_validator():
    provider = ScriptedProvider(dumps(CASE))
    events = collect(generate_workflow(provider, "Investigation case with evidence review", spec=CMMN))
    assert events[-1].type == "result"
    body = json.loads(event_payload(events[-1], CMMN).split("data: ", 1)[1])
    assert {n["type"] for n in body["graph"]["nodes"]} >= {"cmmnHumanTask", "cmmnSentry"}


def test_generated_case_with_a_broken_sentry_is_sent_back():
    broken = json.loads(dumps(CASE))
    broken["edges"] = [e for e in broken["edges"] if e["criterionType"] != "onPart"]  # sentries lose their events
    provider = ScriptedProvider(json.dumps(broken), dumps(CASE))
    events = collect(generate_workflow(provider, "Investigation case", spec=CMMN))
    assert [e.type for e in events] == ["attempt", "invalid", "attempt", "result"]
    assert "CD008" in provider.calls[1][2].text


def test_generate_decisions_returns_a_dmn_model_for_the_spa():
    provider = ScriptedProvider(dumps(DECISIONS))
    events = collect(generate_workflow(provider, "Risk scoring decisions", spec=DMN))
    body = json.loads(event_payload(events[-1], DMN).split("data: ", 1)[1])
    assert [d["decisionTable"]["hitPolicy"] for d in body["graph"]["dmnModel"]["decisions"]] == ["COLLECT", "PRIORITY", "UNIQUE"]


# --- Edit (complete updated model, diffed by code) ------------------------------------------------

def test_case_edit_returns_the_model_and_a_code_computed_diff():
    after = json.loads(dumps(CASE))
    after["nodes"].append({"id": "legal", "type": "cmmnHumanTask", "label": "Legal review"})
    events = collect(edit_workflow(ScriptedProvider(json.dumps(after)), CASE, "Add a legal review", spec=CMMN))
    result = events[-1]
    assert result.type == "result" and result.diff["addedNodes"] == ["legal"]
    assert result.ops == []  # no patch ops outside BPMN


def test_edit_sends_the_current_model_as_fenced_data():
    after = json.loads(dumps(CASE))
    after["nodes"].append({"id": "legal", "type": "cmmnHumanTask", "label": "Legal review"})
    provider = ScriptedProvider(json.dumps(after))
    collect(edit_workflow(provider, CASE, "Add a legal review", spec=CMMN))
    text = provider.calls[0][0].text
    assert text.startswith("<current>\n") and "</current>\n<instruction>\nAdd a legal review\n</instruction>" in text


def test_decision_edit_diff_names_changed_rules():
    after = json.loads(dumps(DECISIONS))
    unique = after["decisions"][2]
    unique["rules"][0]["outputEntries"][0] = '"Escalate to board"'  # first of its two outputs
    events = collect(edit_workflow(ScriptedProvider(json.dumps(after)), DECISIONS, "Escalate rule 1 to the board", spec=DMN))
    result = events[-1]
    assert result.type == "result"
    (changed,) = result.diff["changedDecisions"]
    assert changed["id"] == unique["id"] and changed["changedRules"] == [unique["rules"][0]["id"]]
    assert changed["tableChanged"] is False


def test_decision_edit_that_breaks_uniqueness_is_rejected():
    after = json.loads(dumps(DECISIONS))
    rules = after["decisions"][2]["rules"]
    rules.append({**rules[0], "id": "Rule_dup"})  # same inputs again under UNIQUE
    events = collect(edit_workflow(ScriptedProvider(*[json.dumps(after)] * 3), DECISIONS, "Add a rule", spec=DMN))
    assert events[-1].type == "failed" and {i.code for i in events[-1].issues} == {"DM009"}


def test_returning_the_model_unchanged_is_not_an_edit():
    events = collect(edit_workflow(ScriptedProvider(dumps(DECISIONS), dumps(DECISIONS), dumps(DECISIONS)),
                                   DECISIONS, "Make it better", spec=DMN))
    assert events[-1].type == "failed" and "Nothing changed" in events[-1].issues[0].message


# --- Review --------------------------------------------------------------------------------------

def test_decision_review_grounds_findings_in_rule_ids():
    rule_id = DECISIONS.decisions[2].rules[0].id
    provider = ScriptedProvider(json.dumps({"findings": [
        {"severity": "warning", "category": "rule_gap", "message": "No rule for department 'Legal'.",
         "nodeIds": [DECISIONS.decisions[2].id, rule_id, "Rule_invented"]},
    ]}))
    (result,) = [e for e in collect(review_workflow(provider, DECISIONS, spec=DMN)) if e.type == "result"]
    (f,) = result.findings
    assert (f.code, f.node_ids) == ("rule_gap", (DECISIONS.decisions[2].id, rule_id))
    assert provider.calls[0][0].text.startswith("<graph>\n")


def test_case_review_uses_cmmn_hints():
    from agentic_designer.review import review_system_prompt

    # The CMMN categories, not BPMN's gateway advice, reach the model.
    prompt = review_system_prompt(CMMN)
    assert "milestone that can never become available" in prompt
    assert "exclusive gateway" not in prompt


# --- HTTP ------------------------------------------------------------------------------------------

def _client(provider):
    v = LocalVerifier()
    return TestClient(create_app(provider=provider, verifier=v, usage_sink=RecordingSink())), {"Authorization": f"Bearer {v.token()}"}


def test_edit_endpoint_keeps_dmn_file_metadata_and_table_ids():
    after = json.loads(dumps(DECISIONS))
    after["decisions"][0]["name"] = "Risk Score Total"
    c, auth = _client(ScriptedProvider(json.dumps(after)))
    resp = c.post("/edit", json={"spec": "DMN", "instruction": "Rename the first decision", "graph": {"nodes": [], "edges": [], "dmnModel": DMN_MODEL}}, headers=auth)
    body = json.loads(resp.text.strip().split("\n\n")[-1].split("data: ", 1)[1])
    model = body["graph"]["dmnModel"]
    assert model["definitionsId"] == DMN_MODEL["definitionsId"]
    assert model["decisions"][0]["decisionTable"]["id"] == DMN_MODEL["decisions"][0]["decisionTable"]["id"]


def test_review_endpoint_accepts_a_cmmn_canvas():
    c, auth = _client(ScriptedProvider(json.dumps({"findings": []})))
    resp = c.post("/review", json={"spec": "CMMN", "graph": CASE_CANVAS}, headers=auth)
    assert resp.status_code == 200 and "event: result" in resp.text


def test_bpmn_canvas_sent_as_cmmn_is_refused_before_any_model_call():
    provider = ScriptedProvider()
    c, auth = _client(provider)
    bpmn = {"nodes": [{"id": "t", "type": "userTask", "position": {"x": 0, "y": 0}, "data": {"label": "T"}}], "edges": []}
    assert c.post("/review", json={"spec": "CMMN", "graph": bpmn}, headers=auth).status_code == 422
    assert provider.calls == []


def test_unknown_spec_is_rejected():
    c, auth = _client(ScriptedProvider())
    assert c.post("/generate", json={"spec": "XPDL", "description": "A process with several steps"}, headers=auth).status_code == 422
