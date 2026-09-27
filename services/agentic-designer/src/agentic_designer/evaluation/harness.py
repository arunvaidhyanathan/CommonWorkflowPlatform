"""Runs evaluation cases against one provider/model and summarizes them.

Every case goes through the real Generate / Edit / Review loop behind
MeteredProvider, so attempts, tokens and cost are measured the same way as
in production. A provider rate limit (NVIDIA's free tier throttles bursts)
retries the whole case after a backoff; other provider errors are recorded.
"""

import asyncio
import time
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from decimal import Decimal

from ..edit import edit_workflow
from ..generate import generate_workflow
from ..llm import LLMProvider, ProviderError
from ..review import review_workflow
from ..specs import SPECS
from ..usage import MeteredProvider, PriceTable, UsageContext
from ..grounding import examples_block, ground
from .cases import Case
from .tenant import InMemoryStore


class _Collect:
    def __init__(self):
        self.events = []

    def record(self, event):
        self.events.append(event)


@dataclass
class CaseResult:
    id: str
    mode: str
    spec: str
    outcome: str  # valid | failed | error
    attempts: int = 0
    seconds: float = 0.0
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: str | None = None  # None when any call was unpriced
    checks: list[dict] = field(default_factory=list)
    error: str | None = None
    grounded_on: list[str] = field(default_factory=list)  # tenant workflows used as examples
    # Attempts where the model returned nothing at all: "no answer", as
    # opposed to a wrong answer. A provider-reliability signal, not quality.
    empty_replies: int = 0

    @property
    def checks_passed(self) -> int:
        return sum(c["passed"] for c in self.checks)


def review_caught(findings, expect: dict) -> bool:
    categories = expect.get("categories") or [expect.get("category") or expect.get("code")]
    for f in findings:
        if f.source != expect["source"] or f.code not in categories:
            continue
        node = expect.get("node")
        if node is None or node in f.node_ids or (expect["source"] == "ai" and not f.node_ids):
            return True
    return False


async def run_case(provider: LLMProvider, case: Case, max_rate_limit_retries: int = 2, backoff_s: float = 30,
                   embedder=None) -> CaseResult:
    spec = SPECS[case.spec]
    for attempt_run in range(max_rate_limit_retries + 1):
        sink = _Collect()
        metered = MeteredProvider(provider, sink, PriceTable.bundled(),
                                  UsageContext(feature=f"eval-{case.mode}", tenant_id="eval", user_id="eval", request_id=case.id))
        started = time.monotonic()
        result = CaseResult(case.id, case.mode, case.spec, "error")
        examples: list = []
        try:
            if case.tenant:
                if embedder is None:
                    result.error = "grounding case needs an embedder"
                    result.checks = _all_failed(case, result.error)
                    return result
                examples = await ground(InMemoryStore(list(case.tenant), case.spec), embedder, spec, case.text, None)
            result.grounded_on = [e.name for e in examples]
            block = examples_block(examples)
            if case.mode == "generate":
                events = [e async for e in generate_workflow(metered, case.text, spec=spec, examples=block)]
            elif case.mode == "edit":
                events = [e async for e in edit_workflow(metered, case.base, case.text, spec=spec, examples=block)]
            else:
                events = [e async for e in review_workflow(metered, case.base, case.text or None, spec=spec)]
        except ProviderError as exc:
            if exc.kind == "rate_limited" and attempt_run < max_rate_limit_retries:
                await asyncio.sleep(backoff_s * (attempt_run + 1))
                continue
            result.error = exc.user_message
            events = []
        result.seconds = round(time.monotonic() - started, 1)
        result.attempts = sum(e.type == "attempt" for e in events)
        result.empty_replies = sum(
            e.type == "invalid" and any("empty reply" in i.message for i in getattr(e, "issues", [])) for e in events)
        result.calls = len(sink.events)
        result.input_tokens = sum(e.input_tokens for e in sink.events)
        result.output_tokens = sum(e.output_tokens for e in sink.events)
        costs = [e.cost_usd for e in sink.events if e.outcome == "ok"]
        result.cost_usd = None if any(c is None for c in costs) or not costs else str(sum(Decimal(c) for c in costs))
        final = events[-1] if events else None
        if final is None:
            # A provider error or timeout: nothing to check, so every check fails
            # (an empty list would read as "0/0, nothing missed").
            result.checks = _all_failed(case, result.error or "provider error")
            return result
        if case.mode == "review":
            result.outcome = "valid" if final.type == "result" and final.ai_available else "failed"
            caught = review_caught(final.findings, case.expect)
            result.checks = [{"name": f"reports {case.expect}", "passed": caught,
                              "detail": ", ".join(sorted({f'{f.source}:{f.code}' for f in final.findings}))}]
        elif final.type == "result":
            result.outcome = "valid"
            for check in case.checks:
                try:
                    name, passed, detail = check(final.graph, case.base)
                except Exception as exc:  # a broken check fails itself, not the whole run
                    name, passed, detail = check.label, False, f"check error: {type(exc).__name__}: {exc}"
                result.checks.append({"name": name, "passed": passed, "detail": detail})
        else:
            result.outcome = "failed"
            result.checks = _all_failed(case, "no valid result")
            result.error = "; ".join(f"{i.code}: {i.message}" for i in final.issues)[:300] or None
        return result
    failed = CaseResult(case.id, case.mode, case.spec, "error", error="rate limited after retries")
    failed.checks = _all_failed(case, failed.error)
    return failed


def _all_failed(case: Case, why: str) -> list[dict]:
    if case.mode == "review":
        return [{"name": f"reports {case.expect}", "passed": False, "detail": why}]
    return [{"name": c.label, "passed": False, "detail": why} for c in case.checks]


def summarize(results: list[CaseResult]) -> dict:
    groups: dict[str, list[CaseResult]] = {}
    for r in results:
        groups.setdefault(f"{r.mode}/{r.spec}", []).append(r)
        groups.setdefault("all", []).append(r)
    out = {}
    for key, rs in groups.items():
        checks = sum(len(r.checks) for r in rs)
        priced = [Decimal(r.cost_usd) for r in rs if r.cost_usd is not None]
        out[key] = {
            "cases": len(rs),
            "valid": sum(r.outcome == "valid" for r in rs),
            "errors": sum(r.outcome == "error" for r in rs),
            "checks_passed": sum(r.checks_passed for r in rs),
            "checks_total": checks,
            "mean_seconds": round(sum(r.seconds for r in rs) / len(rs), 1),
            "mean_attempts": round(sum(r.attempts for r in rs) / len(rs), 2),
            "empty_replies": sum(r.empty_replies for r in rs),
            # failed only because every attempt came back empty
            "no_answer": sum(r.outcome == "failed" and r.attempts > 0 and r.empty_replies == r.attempts for r in rs),
            "tokens": sum(r.input_tokens + r.output_tokens for r in rs),
            "cost_usd": str(sum(priced)) if priced and len(priced) == len(rs) else None,
        }
    return out


async def run_all(provider: LLMProvider, cases: list[Case], pause_s: float = 0, on_result=None, embedder=None) -> dict:
    started = datetime.now(UTC).isoformat(timespec="seconds")
    results = []
    for i, case in enumerate(cases):
        if i and pause_s:
            await asyncio.sleep(pause_s)
        r = await run_case(provider, case, embedder=embedder)
        results.append(r)
        if on_result:
            on_result(r)
    return {
        "provider": provider.name,
        "model": provider.model,
        "started": started,
        "finished": datetime.now(UTC).isoformat(timespec="seconds"),
        "summary": summarize(results),
        "cases": [asdict(r) for r in results],
    }
