"""Edit mode (A2): the model proposes patch ops against the current graph;
only edits that don't break anything new reach the canvas, and the user
sees exactly what changed."""

import asyncio
import json

from fastapi.testclient import TestClient

from agentic_designer.app import create_app
from agentic_designer.canvas import to_canvas
from agentic_designer.edit import edit_workflow
from agentic_designer.graph import Edge, Node
from fixtures import BROKEN, loan_approval, with_changes
from stubs import LocalVerifier, RecordingSink, ScriptedProvider

INSERT_COMPLIANCE = json.dumps({"ops": [
    {"op": "add_node", "node": {"id": "compliance", "type": "userTask", "label": "Compliance review"}},
    {"op": "disconnect", "edgeId": "f2"},
    {"op": "connect", "edge": {"id": "f2a", "source": "review", "target": "compliance"}},
    {"op": "connect", "edge": {"id": "f2b", "source": "compliance", "target": "amount_check"}},
]})


def run(provider, graph=None, instruction="Add a compliance review after the application review"):
    async def collect():
        return [e async for e in edit_workflow(provider, graph or loan_approval(), instruction)]
    return asyncio.run(collect())


def test_valid_edit_returns_ops_graph_and_diff():
    events = run(ScriptedProvider(INSERT_COMPLIANCE))
    result = events[-1]
    assert result.type == "result"
    assert result.graph.node("compliance") is not None
    assert (result.diff["addedNodes"], result.diff["removedEdges"]) == (["compliance"], ["f2"])
    assert set(result.diff["addedEdges"]) == {"f2a", "f2b"}
    assert result.diff["changedNodes"] == []  # nothing else touched


def test_model_sees_the_current_graph_and_the_instruction_as_fenced_data():
    provider = ScriptedProvider(INSERT_COMPLIANCE)
    run(provider)
    text = provider.calls[0][0].text
    assert text.startswith("<current_graph>\n") and "</current_graph>\n<instruction>\n" in text
    assert '"amount_check"' in text  # the real graph, so it can reuse existing ids


def test_op_referring_to_a_missing_node_is_sent_back_with_its_index():
    bad = json.dumps({"ops": [{"op": "update_node", "id": "manager", "changes": {"label": "Senior approval"}},
                              {"op": "remove_node", "id": "no_such_node"}]})
    provider = ScriptedProvider(bad, INSERT_COMPLIANCE)
    events = run(provider)
    assert [e.type for e in events] == ["attempt", "invalid", "attempt", "result"]
    feedback = provider.calls[1][2].text
    assert "patch op 1" in feedback and "no_such_node" in feedback


def test_edit_that_breaks_the_process_is_rejected():
    # Removing the manager step without reconnecting leaves the gateway's
    # "yes" branch dangling: an error this edit introduced.
    breaks = json.dumps({"ops": [{"op": "remove_node", "id": "merge"}]})
    events = run(ScriptedProvider(breaks, breaks, breaks))
    assert events[-1].type == "failed"
    assert events[-1].graph is None
    # The manager step becomes a dead end and disbursement unreachable.
    assert {i.code for i in events[-1].issues} == {"AD009", "AD010"}


def test_problems_that_were_already_there_do_not_block_an_edit():
    # The user's draft already has an ambiguous gateway (AD011). Renaming a
    # task must still be possible; the old problem is reported, not blamed on the edit.
    draft = BROKEN["AD011"]
    rename = json.dumps({"ops": [{"op": "update_node", "id": "review", "changes": {"label": "Check application"}}]})
    result = run(ScriptedProvider(rename), graph=draft, instruction="Rename the review step")[-1]
    assert result.type == "result"
    assert [i.code for i in result.preexisting] == ["AD011"]
    assert result.diff["changedNodes"] == ["review"]


def test_an_edit_that_changes_nothing_is_not_accepted():
    noop = json.dumps({"ops": []})
    provider = ScriptedProvider(noop, INSERT_COMPLIANCE)
    events = run(provider)
    assert events[1].type == "invalid" and "Nothing changed" in events[1].issues[0].message
    assert events[-1].type == "result"


def test_original_graph_is_untouched():
    original = loan_approval()
    run(ScriptedProvider(INSERT_COMPLIANCE), graph=original)
    assert original == loan_approval()


# --- HTTP --------------------------------------------------------------------------

def client(provider, sink=None, verifier=None):
    verifier = verifier or LocalVerifier()
    app = create_app(provider=provider, verifier=verifier, usage_sink=sink or RecordingSink())
    return TestClient(app), verifier


def test_edit_endpoint_streams_ops_and_a_canvas_graph():
    sink = RecordingSink()
    c, v = client(ScriptedProvider(INSERT_COMPLIANCE), sink)
    resp = c.post("/edit", json={"instruction": "Add a compliance review after review", "graph": to_canvas(loan_approval())},
                  headers={"Authorization": f"Bearer {v.token()}"})
    assert resp.status_code == 200
    blocks = [b for b in resp.text.strip().split("\n\n")]
    name, data = blocks[-1].split("\n", 1)
    body = json.loads(data.removeprefix("data: "))
    assert name == "event: result"
    assert body["diff"]["addedNodes"] == ["compliance"]
    assert [op["op"] for op in body["ops"]] == ["add_node", "disconnect", "connect", "connect"]
    assert {n["id"] for n in body["graph"]["nodes"]} >= {"compliance", "review"}
    assert [e.feature for e in sink.events] == ["edit"]  # metered as its own feature


def test_canvas_with_unsupported_elements_is_refused_before_any_model_call():
    provider = ScriptedProvider()
    c, v = client(provider)
    canvas = to_canvas(loan_approval())
    canvas["nodes"].append({"id": "timer", "type": "boundaryEvent", "position": {"x": 0, "y": 0}, "data": {"label": "t"}})
    resp = c.post("/edit", json={"instruction": "Add a compliance review", "graph": canvas},
                  headers={"Authorization": f"Bearer {v.token()}"})
    assert resp.status_code == 422
    assert provider.calls == []


def test_empty_canvas_points_to_generate():
    c, v = client(ScriptedProvider())
    resp = c.post("/edit", json={"instruction": "Add a compliance review", "graph": {"nodes": [], "edges": []}},
                  headers={"Authorization": f"Bearer {v.token()}"})
    assert resp.status_code == 422 and "Generate" in resp.json()["detail"]


def test_edit_requires_an_authoring_role():
    c, v = client(ScriptedProvider(INSERT_COMPLIANCE))
    resp = c.post("/edit", json={"instruction": "Add a compliance review", "graph": to_canvas(loan_approval())},
                  headers={"Authorization": f"Bearer {v.token(role='approver')}"})
    assert resp.status_code == 403


# --- flaky hosted models ----------------------------------------------------------------

class EmptyThen(ScriptedProvider):
    """Returns `empties` empty replies first, as Kimi K3 did on 2 of 3 live edit prompts."""

    def __init__(self, empties, *responses):
        super().__init__(*responses)
        self._empties = empties

    async def generate_json(self, system, turns, schema):
        from agentic_designer.llm import ProviderError

        self.calls.append(list(turns))
        if self._empties:
            self._empties -= 1
            raise ProviderError("empty", kind="empty")
        from agentic_designer.llm import Completion

        return Completion(self._responses.pop(0), 10, 5)


def test_empty_reply_is_retried_with_the_same_conversation():
    provider = EmptyThen(1, INSERT_COMPLIANCE)
    events = run(provider)
    assert [e.type for e in events] == ["attempt", "invalid", "attempt", "result"]
    assert events[1].issues[0].code == "AD000"
    # Nothing to correct after an empty reply: the retry sends the same turns.
    assert provider.calls[1] == provider.calls[0]


def test_empty_replies_use_up_the_repair_budget_then_fail():
    events = run(EmptyThen(3))
    assert events[-1].type == "failed"


def test_generate_also_retries_empty_replies():
    from agentic_designer.generate import generate_workflow

    provider = EmptyThen(1, loan_approval().model_dump_json(by_alias=True))

    async def collect():
        return [e async for e in generate_workflow(provider, "Loan application with manager approval")]

    assert asyncio.run(collect())[-1].type == "result"


def test_slow_model_gets_keepalive_comments():
    from agentic_designer.app import with_keepalive

    async def slow():
        await asyncio.sleep(0.25)
        yield "done"

    async def collect():
        return [x async for x in with_keepalive(slow(), 0.1)]

    items = asyncio.run(collect())
    assert items[-1] == "done" and items.count(None) >= 1


def test_edit_can_use_its_own_model(monkeypatch):
    from agentic_designer.app import create_app

    monkeypatch.setenv("AGENT_PROVIDER", "nvidia")
    monkeypatch.setenv("NVIDIA_API_KEY", "k")
    monkeypatch.setenv("AGENT_MODEL", "moonshotai/kimi-k3")
    monkeypatch.setenv("AGENT_EDIT_MODEL", "z-ai/glm-5.3")
    app = create_app(verifier=LocalVerifier(), usage_sink=RecordingSink())
    assert app.state.provider.model == "moonshotai/kimi-k3"
    assert app.state.edit_provider.model == "z-ai/glm-5.3"
