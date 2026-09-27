"""Grounding (A5): the tenant's similar workflows reach the model as fenced
examples; the database scopes access (the store talks as the user); and
grounding can never fail a request."""

import asyncio
import json

import httpx
from fastapi.testclient import TestClient

from agentic_designer.app import GroundingConfig, create_app
from agentic_designer.canvas import to_canvas
from agentic_designer.grounding import (
    GROUNDING_RULE, MIN_SIMILARITY, Example, SupabaseStore, examples_block, ground, index_missing, summarize,
)
from agentic_designer.specs import BPMN, DMN
from fixtures import loan_approval
from stubs import LocalVerifier, RecordingSink, ScriptedProvider

DMN_MODEL = json.loads(open("tests/data/investigation_decisions.dmnmodel.json").read())


class FakeEmbedder:
    name, model, key_alias = "fake", "fake-embed", "FAKE_KEY"

    def __init__(self):
        self.calls = []

    async def embed(self, texts, kind):
        self.calls.append((kind, list(texts)))
        return [[1.0, float(len(t) % 7)] for t in texts], 10 * len(texts)


class MemoryStore:
    """In-memory GroundingStore: one tenant's rows, as RLS would expose them."""

    def __init__(self, workflows, graphs, embedded=(), matches=()):
        self._workflows, self._graphs = workflows, graphs
        self.embedded = set(embedded)
        self.saved, self.match_args = [], None
        self._matches = list(matches)

    async def workflows(self, spec):
        return self._workflows

    async def embedded_versions(self, model):
        return set(self.embedded)

    async def version_graphs(self, ids):
        return {i: self._graphs[i] for i in ids if i in self._graphs}

    async def save(self, rows):
        self.saved += rows
        self.embedded |= {r["workflow_version_id"] for r in rows}

    async def match(self, vector, spec, model, k, exclude):
        self.match_args = (spec, model, k, exclude)
        return [m for m in self._matches if m.workflow_id != exclude]


LOAN = to_canvas(loan_approval())


def run(coro):
    return asyncio.run(coro)


# --- summaries ------------------------------------------------------------------------------

def test_bpmn_summary_shows_the_conventions_worth_copying():
    text = summarize(BPMN, "Loan approval", LOAN)
    assert "groups underwriters" in text and "assignee ${manager}" in text
    assert "condition ${amount > 10000}" in text and "delegate ${disburseDelegate}" in text


def test_dmn_summary_shows_columns_and_sample_rules():
    text = summarize(DMN, "Investigation decisions", {"dmnModel": DMN_MODEL})
    assert "priorIncidentCount:number" in text and "COLLECT/SUM" in text and '"Trading" | >= 3 -> 25' in text


def test_unreadable_version_has_no_summary():
    bad = {"nodes": [{"id": "x", "type": "boundaryEvent", "position": {"x": 0, "y": 0}, "data": {"label": "t"}}], "edges": []}
    assert summarize(BPMN, "Odd", bad) is None


# --- indexing ------------------------------------------------------------------------------------

def test_only_versions_without_an_embedding_are_embedded():
    store = MemoryStore([{"id": "w1", "name": "Loan", "current_version_id": "v1"},
                         {"id": "w2", "name": "Old", "current_version_id": "v2"}], {"v1": LOAN, "v2": LOAN}, embedded={"v2"})
    embedder = FakeEmbedder()
    assert run(index_missing(store, embedder, BPMN, max_new=20)) == 1
    (row,) = store.saved
    assert (row["workflow_version_id"], row["model"], row["spec_type"]) == ("v1", "fake-embed", "BPMN")
    assert embedder.calls == [("passage", [row["summary"]])]


def test_indexing_is_capped_per_request():
    wfs = [{"id": f"w{i}", "name": f"W{i}", "current_version_id": f"v{i}"} for i in range(30)]
    store = MemoryStore(wfs, {f"v{i}": LOAN for i in range(30)})
    assert run(index_missing(store, FakeEmbedder(), BPMN, max_new=5)) == 5


# --- retrieval --------------------------------------------------------------------------------------

def test_ground_returns_similar_workflows_and_never_the_open_one():
    store = MemoryStore([], {}, matches=[Example("w1", "Loan", "Workflow: Loan", 0.8),
                                         Example("w9", "Self", "Workflow: Self", 0.99),
                                         Example("w2", "Unrelated", "Workflow: Unrelated", MIN_SIMILARITY - 0.01)])
    found = run(ground(store, FakeEmbedder(), BPMN, "loan approval", exclude_workflow="w9"))
    assert [e.workflow_id for e in found] == ["w1"]  # self excluded, weak match dropped
    assert store.match_args == ("BPMN", "fake-embed", 3, "w9")


def test_grounding_failure_means_no_examples_not_an_error():
    class Broken(MemoryStore):
        async def workflows(self, spec):
            raise httpx.ConnectError("supabase down")

    assert run(ground(Broken([], {}), FakeEmbedder(), BPMN, "loan", None)) == []


def test_examples_are_fenced_and_only_added_when_present():
    assert examples_block([]) == ""
    block = examples_block([Example("w1", "Loan", "Workflow: Loan\n- userTask: Review", 0.8)])
    assert block.startswith("\n<tenant_examples>\n") and block.endswith("\n</tenant_examples>")


def test_generate_adds_examples_and_the_rule_only_with_grounding():
    from agentic_designer.generate import generate_workflow

    async def go(provider, examples):
        return [e async for e in generate_workflow(provider, "Loan approval process", examples=examples)]

    with_ex, without = ScriptedProvider(json.dumps(json.loads(loan_approval().model_dump_json(by_alias=True)))), \
        ScriptedProvider(loan_approval().model_dump_json(by_alias=True))
    run(go(with_ex, examples_block([Example("w1", "Loan", "Workflow: Loan", 0.8)])))
    run(go(without, ""))
    assert "<tenant_examples>" in with_ex.calls[0][0].text and GROUNDING_RULE in with_ex.systems[0]
    assert "<tenant_examples>" not in without.calls[0][0].text and GROUNDING_RULE not in without.systems[0]


# --- the Supabase store talks as the user --------------------------------------------------------------

def test_supabase_store_uses_the_users_token_and_upserts():
    seen = []

    def handler(request):
        seen.append(request)
        if request.url.path.endswith("/rpc/match_workflow_embeddings"):
            return httpx.Response(200, json=[{"workflow_id": "w1", "workflow_version_id": "v1", "name": "Loan",
                                              "summary": "Workflow: Loan", "similarity": 0.7}])
        return httpx.Response(201 if request.method == "POST" else 200, json=[])

    store = SupabaseStore("https://proj.supabase.co", "anon-key", "user-jwt", "tenant-1",
                          client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    run(store.save([{"workflow_id": "w1", "workflow_version_id": "v1", "spec_type": "BPMN", "model": "m",
                     "content_hash": "h", "summary": "s", "embedding": "[1,0]"}]))
    (found,) = run(store.match([1.0, 0.0], "BPMN", "m", 3, None))
    save, match = seen
    for r in seen:
        # RLS scopes by the caller: the user's JWT, never a service key.
        assert r.headers["authorization"] == "Bearer user-jwt" and r.headers["apikey"] == "anon-key"
    assert save.url.params["on_conflict"] == "workflow_version_id,model"
    assert json.loads(save.content)[0]["tenant_id"] == "tenant-1"
    assert json.loads(match.content)["match_spec"] == "BPMN" and found.similarity == 0.7


# --- through the API -----------------------------------------------------------------------------------

def test_generate_streams_the_examples_used_and_meters_embeddings():
    store = MemoryStore([{"id": "w1", "name": "House loan", "current_version_id": "v1"}], {"v1": LOAN},
                        matches=[Example("w1", "House loan", "Workflow: House loan", 0.8)])
    sink, verifier, provider = RecordingSink(), LocalVerifier(), ScriptedProvider(loan_approval().model_dump_json(by_alias=True))
    app = create_app(provider=provider, verifier=verifier, usage_sink=sink,
                     grounding=GroundingConfig(store_for=lambda token, tenant: store, embedder=FakeEmbedder()))
    resp = TestClient(app).post("/generate", json={"description": "Loan approval with a manager", "workflowId": "w7"},
                                headers={"Authorization": f"Bearer {verifier.token()}"})
    first = resp.text.split("\n\n")[0]
    assert first.startswith("event: grounding")
    body = json.loads(first.split("data: ", 1)[1])
    assert body == {"enabled": True, "examples": [{"workflowId": "w1", "name": "House loan", "similarity": 0.8}]}
    assert "<tenant_examples>" in provider.calls[0][0].text
    assert store.match_args[3] == "w7"  # the open workflow is excluded
    assert sorted(e.feature for e in sink.events) == ["embed", "embed", "generate"]  # index + query + model call
