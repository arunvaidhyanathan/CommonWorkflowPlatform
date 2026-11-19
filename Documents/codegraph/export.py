"""Export a CodeGraph snapshot of the repo into Documents/codegraph/.

Usage (repo root, after `codegraph init --local-only` once and `codegraph sync`):
    python3 -I Documents/codegraph/export.py .
"""
import json
import os
import pathlib
import subprocess
import sys

repo = pathlib.Path(sys.argv[1]).resolve()
out = repo / "Documents" / "codegraph"
out.mkdir(parents=True, exist_ok=True)
env = {**os.environ, "CODEGRAPH_TELEMETRY": "0", "NO_COLOR": "1"}


def cg(*args):
    r = subprocess.run(["codegraph", *args], cwd=repo, env=env, capture_output=True, text=True)
    return r.stdout.replace(str(repo) + "/", "").replace(str(repo), ".")


status = json.loads(cg("status", "--json", "."))
for k in ("projectPath", "indexPath"):
    status.pop(k, None)
(out / "index-stats.json").write_text(json.dumps(status, indent=2) + "\n")

routes = json.loads(cg("query", "", "--kind", "route", "--limit", "500", "--json"))
by_file = {}
for r in routes:
    n = r["node"]
    by_file.setdefault(n["filePath"], []).append((n["startLine"], n["name"]))

seams = [  # (symbol, defining file suffix or None, why it matters)
    ("requireActive", None, "Role/status re-check against identity-service (design-service and flowable-wrapper)"),
    ("groupKeys", "HttpIdentityDirectory.java", "Task candidate groups from identity-service (flowable-wrapper)"),
    ("isActiveMember", "HttpIdentityDirectory.java", "Assignee must be an active tenant member (flowable-wrapper)"),
    ("record", "DesignAudit.java", "identity-service posting role/status changes to design-service's audit log"),
    ("writer", "DesignDb.java", "Every design-time write goes through DesignDb.writer() (identity check + audit claims)"),
    ("writer", "IdentityDb.java", "Every identity write goes through IdentityDb.writer()"),
    ("apiFetch", None, "SPA calls to the backend (one client for every service)"),
]

md = ["# CodeGraph snapshot: CommonWorkflowPlatform", "",
      "Generated with [CodeGraph](https://github.com/colbymchenry/codegraph) "
      f"{status.get('version')} from the local index (`.codegraph/`, not committed). "
      "Regenerate: `codegraph sync && python3 -I Documents/codegraph/export.py .` "
      "(see [CodeMaps.html](../CodeMaps.html)).", "",
      "## Index", "",
      f"- Files: {status['fileCount']} ({', '.join(f'{k} {v}' for k, v in status['filesByLanguage'].items())})",
      f"- Symbols: {status['nodeCount']}, edges: {status['edgeCount']}",
      "- By kind: " + ", ".join(f"{k} {v}" for k, v in sorted(status["nodesByKind"].items(), key=lambda kv: -kv[1])),
      f"- Parse errors: {status['index']['filesWithParseErrors']}", "",
      "## Routes detected", "",
      "HTTP routes CodeGraph found: Spring `@*Mapping` endpoints, FastAPI routes and the SPA's React Router routes. "
      "Paths are as each service serves them (the gateway adds `/api/identity`, `/api/design`, `/api/flowable`, ...).", ""]
for f in sorted(by_file):
    md.append(f"- `{f}`: " + ", ".join(f"`{name}` (L{line})" for line, name in sorted(by_file[f])))
md += ["", "## Cross-service seams (callers)", ""]
for sym, file, why in seams:
    args = ["callers", sym, "--limit", "40"] + (["--file", file] if file else [])
    title = f"`{sym}`" + (f" in `{file}`" if file else "")
    md += [f"### {title}", "", why, "", "```", cg(*args).strip(), "```", ""]
(out / "README.md").write_text("\n".join(md))
print("wrote", out / "README.md", "and", out / "index-stats.json", "| routes:", len(routes))
