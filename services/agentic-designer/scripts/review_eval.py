"""Review-mode evaluation (AgenticDesigner.html A3; seed of the A5 harness).

Runs every seeded-defect sample in tests/review_samples.py through Review
with the configured provider (AGENT_PROVIDER, AGENT_MODEL and its key) and
reports which planted defects were caught. Makes real, metered model calls.

    uv run python scripts/review_eval.py [runs_per_sample]
"""

import asyncio
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "tests"))

from review_samples import SAMPLES, caught  # noqa: E402

from agentic_designer.app import _provider_from_env  # noqa: E402
from agentic_designer.llm import ProviderError  # noqa: E402
from agentic_designer.review import review_workflow  # noqa: E402


async def review(provider, graph):
    final = None
    async for event in review_workflow(provider, graph):
        if event.type == "result":
            final = event
    return final


async def main(runs: int) -> int:
    provider = _provider_from_env()
    if provider is None:
        print("No provider configured.")
        return 2
    print(f"provider={provider.name} model={provider.model} runs={runs}\n")
    hits = total = 0
    for name, sample in SAMPLES.items():
        n = runs if sample["expect"]["source"] == "ai" else 1
        for i in range(n):
            started = time.time()
            try:
                final = await review(provider, sample["graph"])
                ok = caught(final.findings, sample["expect"])
                found = sorted({f"{f.source}:{f.code}" for f in final.findings})
                note = "" if final.ai_available else " (AI unavailable: checks only)"
            except ProviderError as exc:
                ok, found, note = False, [], f" (provider error: {exc.user_message})"
            hits += ok
            total += 1
            print(f"{'CAUGHT' if ok else 'MISSED'} {name:<24} run {i}  {time.time() - started:5.1f}s  found={found}{note}")
    print(f"\n{hits}/{total} seeded defects caught")
    return 0 if hits == total else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 1)))
