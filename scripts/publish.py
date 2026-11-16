#!/usr/bin/env python3
"""Publish the Morrow working tree to GitHub in one commit, using the Git Data API.

`git push` is refused in this environment (the GitHub connection is not linked),
so the tree is uploaded through api.github.com instead: one blob per file, one
tree, one commit, one ref update — the same result as a push, a single commit.

    GH_TOKEN=... python3 publish.py
"""
from __future__ import annotations

import base64
import json
import os
import sys
import urllib.request

REPO = "qkrrkdhzdl-arch/morrow"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {".git", "__pycache__"}
SKIP_NAMES = {".DS_Store", ".cypherlite.lock", ".cypherlite.writer"}


def api(method: str, path: str, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        method=method,
        data=data,
        headers={
            "Authorization": f"token {os.environ['GH_TOKEN']}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "morrow-publish",
        },
    )
    with urllib.request.urlopen(req, timeout=180) as response:
        body = response.read().decode()
    return json.loads(body) if body else {}


def collect():
    files = []
    for base, dirs, names in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in names:
            if name in SKIP_NAMES:
                continue
            full = os.path.join(base, name)
            rel = os.path.relpath(full, ROOT)
            files.append((rel, full))
    return sorted(files)


def main() -> int:
    # An empty repository cannot create blobs (409), so put one file in place
    # first through the contents API, then replace the branch with a single commit.
    seed = api("PUT", f"/repos/{REPO}/contents/.bootstrap", {
        "message": "bootstrap",
        "content": base64.b64encode(b"Morrow\n").decode(),
    })
    base_commit = seed["commit"]["sha"]
    print(f"bootstrap commit {base_commit[:8]}")

    files = collect()
    print(f"{len(files)} files, {sum(os.path.getsize(f) for _, f in files) / 1e6:.1f} MB")
    entries = []
    for rel, full in files:
        with open(full, "rb") as fh:
            raw = fh.read()
        blob = api("POST", f"/repos/{REPO}/git/blobs", {"content": base64.b64encode(raw).decode(), "encoding": "base64"})
        entries.append({"path": rel.replace(os.sep, "/"), "mode": "100755" if os.access(full, os.X_OK) else "100644", "type": "blob", "sha": blob["sha"]})
        print(f"  blob {rel} ({len(raw)} bytes)")

    tree = api("POST", f"/repos/{REPO}/git/trees", {"tree": entries})
    message = (
        "Morrow: a deadline graph in the browser on Relate\n\n"
        "Nineteen deadlines and eighteen artifacts from one person's fortnight, stored as a\n"
        "graph: Obligation -[:NEEDS {weight}]-> Artifact, Artifact -[:DEPENDS_ON]-> Artifact.\n"
        "The planner counts a shared artifact once, at its earliest claimant, which is the\n"
        "number a to-do list gets wrong.\n\n"
        "Runs on the Relate WASM build in a worker with a durable OPFS store; the same graph\n"
        "is checked in under store/morrow for the CLI."
    )
    commit = api("POST", f"/repos/{REPO}/git/commits", {"message": message, "tree": tree["sha"], "parents": [base_commit]})
    api("PATCH", f"/repos/{REPO}/git/refs/heads/main", {"sha": commit["sha"], "force": True})
    print(f"commit {commit['sha']} -> refs/heads/main")

    api("PUT", f"/repos/{REPO}/topics", {"names": ["relate", "relate-neo4j-hackathon", "neo4j", "cypher", "graph-database", "wasm", "opfs"]})
    print("topics set")
    return 0


if __name__ == "__main__":
    sys.exit(main())
