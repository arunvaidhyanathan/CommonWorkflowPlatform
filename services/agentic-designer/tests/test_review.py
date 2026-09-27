"""Review mode (A3): code checks always, model judgement on top, and nothing
the model says is trusted without checking it against the graph."""

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from agentic_designer.app import create_app
from agentic_designer.canvas import to_canvas
from agentic_designer.review import MAX_AI_FINDINGS, review_workflow
from fixtures import loan_approval
from review_samples import SAMPLES, caught
from stubs import LocalVerifier, RecordingSink, ScriptedProvider


def run(provider, graph=None, focus=None):
    async def collect():
        return [e async for e in review_workflow(provider, graph or loan_approval(), focus)]
    return asyncio.run(collect())


def ai(*findings):
    return json.dumps({"findings": list(findings)})


def result(events):
    (r,) = [e for e in events if e.type == "result"]
    return r


# --- seeded defects found by code ---------------------------------------------------------

@pytest.mark.parametrize("name", [n for n, s in SAMPLES.items() if s["expect"]["source"] == "check"])
def test_seeded_structural_defects_are_reported_without_a_model(name):
    sample = SAMPLES[name]
    events = run(None, sample["graph"])
    assert caught(result(events).findings, sample["expect"])


def test_checks_arrive_before_the_model_answers():
    # They're code; the user shouldn't wait on a slow model to see them.
    events = run(ScriptedProvider(ai()), SAMPLES["unassigned_task"]["graph"])
    assert events[0].type == "checks"
    assert [f.code for f in events[0].findings] == ["AD017"]


def test_sound_workflow_can_come_back_clean():
    events = run(ScriptedProvider(ai()))
    assert result(events).findings == []


# --- model findings are checked, not trusted ------------------------------------------------

def test_ai_findings_are_labelled_and_grounded_in_real_ids():
    provider = ScriptedProvider(ai(
        {"severity": "warning", "category": "missing_path", "message": "No path if the manager rejects.",
         "nodeIds": ["manager", "ghost_node"], "edgeIds": ["f5"]},
    ))
    (f,) = result(run(provider)).findings
    assert (f.source, f.code, f.severity) == ("ai", "missing_path", "warning")
    assert f.node_ids == ("manager",)  # the invented id is dropped
    assert f.edge_ids == ("f5",)


def test_finding_that_only_names_invented_ids_is_dropped():
    provider = ScriptedProvider(ai(
        {"severity": "warning", "category": "ordering", "message": "Step X is out of order.", "nodeIds": ["step_x"]},
        {"severity": "suggestion", "category": "other", "message": "Consider documenting the SLA."},
    ))
    findings = result(run(provider)).findings
    assert [f.code for f in findings] == ["other"]  # general finding (no ids) kept


def test_ai_findings_are_capped():
    many = [{"severity": "suggestion", "category": "other", "message": f"Point {i}"} for i in range(25)]
    assert len(result(run(ScriptedProvider(ai(*many)))).findings) == MAX_AI_FINDINGS


def test_model_is_told_what_checks_already_found_and_the_focus():
    provider = ScriptedProvider(ai())
    run(provider, SAMPLES["unassigned_task"]["graph"], focus="Is the approval path complete?")
    text = provider.calls[0][0].text
    assert "<already_found>" in text and "AD017" in text
    assert "<focus>\nIs the approval path complete?\n</focus>" in text


def test_malformed_review_is_retried_then_falls_back_to_checks():
    provider = ScriptedProvider(*['{"verdict": "fine"}'] * 3)
    events = run(provider, SAMPLES["unassigned_task"]["graph"])
    final = result(events)
    assert [f.code for f in final.findings] == ["AD017"]  # the checks still stand
    assert final.ai_available is False
    # Three attempts, like Generate and Edit (live, two were too few for a
    # model that often returns empty replies), and not one call more.
    assert len(provider.calls) == 3


def test_without_a_provider_review_still_returns_the_checks():
    final = result(run(None, SAMPLES["dead_end"]["graph"]))
    assert final.ai_available is False
    assert "AD010" in {f.code for f in final.findings}


# --- HTTP ---------------------------------------------------------------------------------------

def _post(app, verifier, graph, **extra):
    return TestClient(app).post("/review", json={"graph": to_canvas(graph), **extra},
                                headers={"Authorization": f"Bearer {verifier.token()}"})


def test_review_endpoint_streams_checks_then_result_and_meters_as_review():
    v, sink = LocalVerifier(), RecordingSink()
    provider = ScriptedProvider(ai({"severity": "suggestion", "category": "unclear_label", "message": "Vague.", "nodeIds": ["review"]}))
    resp = _post(create_app(provider=provider, verifier=v, usage_sink=sink), v, SAMPLES["unassigned_task"]["graph"])
    names = [b.split("\n", 1)[0] for b in resp.text.strip().split("\n\n")]
    assert names[0] == "event: checks" and names[-1] == "event: result"
    body = json.loads(resp.text.strip().split("\n\n")[-1].split("data: ", 1)[1])
    assert {(f["source"], f["code"]) for f in body["findings"]} == {("check", "AD017"), ("ai", "unclear_label")}
    assert [e.feature for e in sink.events] == ["review"]


def test_review_works_with_no_provider_configured():
    v = LocalVerifier()
    app = create_app(provider=None, verifier=v, usage_sink=RecordingSink())
    app.state.provider = None
    resp = _post(app, v, SAMPLES["dead_end"]["graph"])
    assert resp.status_code == 200  # not 503: the checks don't need a model
    body = json.loads(resp.text.strip().split("\n\n")[-1].split("data: ", 1)[1])
    assert body["aiAvailable"] is False and "AD010" in {f["code"] for f in body["findings"]}


def test_focus_length_is_bounded():
    v = LocalVerifier()
    resp = _post(create_app(provider=ScriptedProvider(), verifier=v, usage_sink=RecordingSink()), v, loan_approval(), focus="x" * 501)
    assert resp.status_code == 422
