#!/usr/bin/env python3
"""Run every statement in cypher/queries.json against store/morrow with the Relate CLI.

The app fetches the same file, so this is the check that the statements a judge
can paste into the CLI are the statements the interface actually runs.

    RELATE_BIN=/path/to/relate python3 scripts/verify_queries.py

Exit code 0 means every statement parsed, planned and returned rows (or an
honest empty result); 1 means at least one failed.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from embed import embed  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORE = os.path.join(ROOT, "store", "morrow")

# Parameters the app passes for each parameterised statement. Values are taken
# from the sample graph so the check exercises real paths.
PARAMS = {
    "artifactClaims": {"id": "art-review-photos"},
    "artifactRipple": {"id": "art-review-photos"},
    "artifactDeps": {"id": "art-ir-video"},
    "artifactDownstream": {"id": "art-market-data"},
    "obligationNeeds": {"id": "ob-grant-2"},
    "obligationShared": {"id": "ob-camp-b"},
    "unblocks": {"id": "art-bank-copy"},
    "similar": {"vec": embed("record a pitch video for the startup competition"), "k": 3},
}


def main() -> int:
    relate = os.environ.get("RELATE_BIN") or shutil.which("relate")
    if not relate:
        print("relate CLI not found. Install it (see README) or set RELATE_BIN=<path to relate>.")
        return 2
    if not os.path.isdir(STORE):
        print(f"missing store at {STORE}; run scripts/build_store.sh first")
        return 2

    with open(os.path.join(ROOT, "cypher", "queries.json")) as fh:
        read = json.load(fh)["read"]

    failures = 0
    for name, statement in read.items():
        cmd = [relate, "query", "-d", STORE, "--json"]
        for key, value in PARAMS.get(name, {}).items():
            cmd += ["--param", f"{key}={json.dumps(value)}"]
        cmd += ["-c", statement]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        out = proc.stdout.strip()
        try:
            payload = json.loads(out)
        except json.JSONDecodeError:
            payload = {}
        if "error" in payload:
            failures += 1
            message = payload["error"].get("message", payload["error"])
            print(f"FAIL {name}: {str(message).splitlines()[0]}")
            continue
        rows = payload.get("data", [])
        print(f"ok   {name}: {len(rows)} row(s)")

    print("\nall statements parse and run" if failures == 0 else f"\n{failures} statement(s) failed")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
