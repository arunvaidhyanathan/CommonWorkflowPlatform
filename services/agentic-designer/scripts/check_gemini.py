"""Diagnose Gemini API problems without printing the key.

    uv run python scripts/check_gemini.py [path/to/.env ...]

1. Where the key lives: fingerprints of every copy (shell, the given .env
   files, the running agent container). Same fingerprint = same key; the
   shell overrides .env in Docker Compose.
2. Whether the key is valid (listing models is free).
3. One tiny real call per model, printing Google's full error. A
   "monthly spending cap" 429 means the project's spend cap in AI Studio
   (https://ai.studio/spend) is reached: credit alone doesn't lift it.
"""

import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request

MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite"]


def key_in(path: str) -> str:
    p = pathlib.Path(os.path.expanduser(path))
    if not p.exists():
        return ""
    for line in p.read_text().splitlines():
        m = re.match(r"\s*(?:export\s+)?GEMINI_API_KEY=(.*)", line)
        if m:
            return m.group(1).strip().strip('"').strip("'")
    return ""


def fingerprint(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()[:10] if key else "empty"


def main() -> int:
    env_files = sys.argv[1:] or ["~/Developer/.env", "../../.env"]
    container = subprocess.run(["docker", "compose", "exec", "-T", "agentic-designer", "printenv", "GEMINI_API_KEY"],
                               capture_output=True, text=True).stdout.strip()
    copies = {"shell env": os.environ.get("GEMINI_API_KEY", ""), **{f: key_in(f) for f in env_files},
              "running agent container": container}
    print("1) Where the key lives (same fingerprint = same key)")
    for name, k in copies.items():
        print(f"   {name:<26} {fingerprint(k)}")
    key = next((k for k in copies.values() if k), "")
    if not key:
        print("   no GEMINI_API_KEY found")
        return 2

    print("\n2) Is the key valid? (listing models is free)")
    try:
        req = urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
                                     headers={"x-goog-api-key": key})
        with urllib.request.urlopen(req, timeout=20) as r:
            names = {m["name"].split("/")[-1] for m in json.load(r)["models"]}
        print(f"   valid; {len(names)} models visible; " + ", ".join(f"{m}: {'listed' if m in names else 'NOT listed'}" for m in MODELS))
    except urllib.error.HTTPError as e:
        print(f"   HTTP {e.code} {e.read()[:300].decode()}")
        return 1

    print("\n3) One tiny real call per model")
    ok = True
    for model in MODELS:
        body = json.dumps({"contents": [{"parts": [{"text": "Say OK"}]}], "generationConfig": {"maxOutputTokens": 5}}).encode()
        req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                                     data=body, headers={"x-goog-api-key": key, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                print(f"   {model}: OK (HTTP {r.status})")
        except urllib.error.HTTPError as e:
            ok = False
            err = json.loads(e.read() or b"{}").get("error", {})
            print(f"   {model}: HTTP {e.code} {err.get('status')}\n      {err.get('message')}")
            for d in err.get("details", []):
                print("      detail:", json.dumps(d)[:400])
            if "spending cap" in (err.get("message") or ""):
                print("      -> Raise the project's monthly spend cap at https://ai.studio/spend (credit alone doesn't lift it).")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
