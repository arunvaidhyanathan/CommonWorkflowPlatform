"""An in-memory tenant for evaluating grounding: the same GroundingStore
interface as Supabase, with exact cosine similarity in Python."""

import json
import math

from ..grounding import Example


class InMemoryStore:
    def __init__(self, workflows: list[tuple[str, dict]], spec: str):
        """``workflows``: (name, graph payload in the Designer's format)."""
        self._rows = [{"id": f"w{i}", "name": name, "current_version_id": f"v{i}"} for i, (name, _) in enumerate(workflows)]
        self._graphs = {f"v{i}": graph for i, (_, graph) in enumerate(workflows)}
        self._spec = spec
        self._saved: list[dict] = []

    async def workflows(self, spec):
        return self._rows if spec == self._spec else []

    async def embedded_versions(self, model):
        return {r["workflow_version_id"] for r in self._saved if r["model"] == model}

    async def version_graphs(self, ids):
        return {i: self._graphs[i] for i in ids}

    async def save(self, rows):
        self._saved += rows

    async def match(self, vector, spec, model, k, exclude):
        def cos(a, b):
            return sum(x * y for x, y in zip(a, b)) / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))
        scored = [Example(r["workflow_id"], next(w["name"] for w in self._rows if w["id"] == r["workflow_id"]),
                          r["summary"], cos(vector, json.loads(r["embedding"])))
                  for r in self._saved if r["model"] == model and r["spec_type"] == spec and r["workflow_id"] != exclude]
        return sorted(scored, key=lambda e: -e.similarity)[:k]
