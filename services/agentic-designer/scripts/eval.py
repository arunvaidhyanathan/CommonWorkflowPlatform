"""Agentic Designer evaluation (AgenticDesigner.html phase A5).

Runs the cases in agentic_designer/evaluation/cases.py (plus the seeded
review samples from tests/review_samples.py) against one provider and
model, and writes a JSON report to evals/reports/. Makes real, metered
model calls.

    uv run python scripts/eval.py run --provider nvidia --model moonshotai/kimi-k3 [--modes generate,edit,review]
                                      [--specs BPMN,CMMN,DMN] [--only CASE_ID,...] [--pause 10] [--env-file ../../.env]
    uv run python scripts/eval.py compare evals/reports/A.json evals/reports/B.json
"""

import argparse
import asyncio
import json
import os
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tests"))

from agentic_designer.app import PROVIDERS, _provider_from_env  # noqa: E402
from agentic_designer.evaluation.cases import Case, edit_cases, generate_cases, grounding_cases, review_cases  # noqa: E402
from agentic_designer.evaluation.harness import run_all  # noqa: E402


def seeded_review_cases() -> list[Case]:
    from review_samples import SAMPLES

    cases = []
    for name, sample in SAMPLES.items():
        e = sample["expect"]
        category = e.get("code") if e["source"] == "check" else e["category"]
        cases.append(Case(f"review-seeded-{name}", "review", "BPMN", "", base=sample["graph"],
                          expect={"source": e["source"], "categories": [category], "node": e["node"]}))
    return cases


def all_cases() -> list[Case]:
    return generate_cases() + edit_cases() + seeded_review_cases() + review_cases() + grounding_cases()


def load_env_file(path: str) -> None:
    """Only the provider key variables are read from the file."""
    wanted = {key_var for key_var, _, _ in PROVIDERS.values()}
    for line in pathlib.Path(path).read_text().splitlines():
        m = re.match(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)", line)
        if m and m.group(1) in wanted and m.group(2).strip():
            os.environ[m.group(1)] = m.group(2).strip().strip('"').strip("'")


def print_result(r) -> None:
    passed = f"{r.checks_passed}/{len(r.checks)}"
    cost = r.cost_usd if r.cost_usd is not None else "unpriced"
    print(f"{r.outcome.upper():<6} {r.id:<34} checks {passed:<5} attempts {r.attempts}  {r.seconds:6.1f}s  "
          f"tokens {r.input_tokens + r.output_tokens:<6} cost {cost}" + (f"  [{r.error[:80]}]" if r.error else "")
          + (f"  grounded on {r.grounded_on}" if r.grounded_on else ""))
    for c in r.checks:
        if not c["passed"]:
            print(f"         - missed: {c['name']}" + (f" ({c['detail'][:100]})" if c["detail"] else ""))


def print_summary(report: dict) -> None:
    print(f"\n{report['provider']} / {report['model']}")
    print(f"{'group':<16} {'valid':>7} {'checks':>9} {'errors':>6} {'no answer':>9} {'mean s':>7} {'attempts':>8} {'tokens':>8} {'cost':>10}")
    for key, s in sorted(report["summary"].items(), key=lambda kv: (kv[0] != "all", kv[0])):
        print(f"{key:<16} {s['valid']:>3}/{s['cases']:<3} {s['checks_passed']:>4}/{s['checks_total']:<4} {s['errors']:>6} "
              f"{s.get('no_answer', 0):>9} {s['mean_seconds']:>7} {s['mean_attempts']:>8} {s['tokens']:>8} {s['cost_usd'] or 'unpriced':>10}")


def cmd_run(args) -> int:
    if args.env_file:
        load_env_file(args.env_file)
    os.environ["AGENT_PROVIDER"] = args.provider
    provider = _provider_from_env(args.model)
    if provider is None:
        print(f"No key for provider {args.provider}.")
        return 2
    cases = all_cases()
    if args.modes:
        cases = [c for c in cases if c.mode in args.modes.split(",")]
    if args.specs:
        cases = [c for c in cases if c.spec in args.specs.split(",")]
    if args.only:
        cases = [c for c in cases if c.id in args.only.split(",")]
    print(f"{len(cases)} cases on {provider.name} / {provider.model}\n")
    embedder = None
    if any(c.tenant for c in cases) and os.environ.get("NVIDIA_API_KEY"):
        from agentic_designer.embeddings import NvidiaEmbedder

        embedder = NvidiaEmbedder(os.environ["NVIDIA_API_KEY"])
    report = asyncio.run(run_all(provider, cases, pause_s=args.pause, on_result=print_result, embedder=embedder))
    out = ROOT / "evals" / "reports" / f"{report['started'].replace(':', '')}-{provider.name}-{provider.model.replace('/', '_')}.json"
    out.write_text(json.dumps(report, indent=1))
    print_summary(report)
    print(f"\nreport: {out.relative_to(ROOT)}")
    return 0


def cmd_compare(args) -> int:
    reports = [json.loads(pathlib.Path(p).read_text()) for p in args.reports]
    keys = sorted({k for r in reports for k in r["summary"]}, key=lambda k: (k != "all", k))
    header = f"{'group':<16}" + "".join(f"{(r['model'].split('/')[-1])[:22]:>26}" for r in reports)
    print(header)
    for key in keys:
        row = f"{key:<16}"
        for r in reports:
            s = r["summary"].get(key)
            row += f"{'-':>26}" if s is None else f"{s['valid']}/{s['cases']} ok, {s['checks_passed']}/{s['checks_total']} chk, {s['mean_seconds']}s".rjust(26)
        print(row)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run")
    run.add_argument("--provider", default=os.environ.get("AGENT_PROVIDER", "gemini"), choices=sorted(PROVIDERS))
    run.add_argument("--model")
    run.add_argument("--modes")
    run.add_argument("--specs")
    run.add_argument("--only")
    run.add_argument("--pause", type=float, default=0, help="seconds between cases (provider rate limits)")
    run.add_argument("--env-file", help="read provider keys from this .env file")
    cmp = sub.add_parser("compare")
    cmp.add_argument("reports", nargs="+")
    args = parser.parse_args()
    return cmd_run(args) if args.cmd == "run" else cmd_compare(args)


if __name__ == "__main__":
    sys.exit(main())
