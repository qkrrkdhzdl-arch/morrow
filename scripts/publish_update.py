#!/usr/bin/env python3
"""Update only the files whose bytes differ from what is on GitHub.

The first publication uses scripts/publish.py (one commit for the whole tree).
After that, this keeps commits small and honest.

    GH_TOKEN=... python3 scripts/publish_update.py [path ...]
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.error
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


def remote_bytes(path: str):
    try:
        data = api("GET", f"/repos/{REPO}/contents/{path}")
    except urllib.error.HTTPError as err:
        if err.code == 404:
            return None, None
        raise
    return base64.b64decode(data["content"]), data["sha"]


def files_to_consider(argv):
    if argv:
        return [(p, os.path.join(ROOT, p)) for p in argv]
    out = []
    for base, dirs, names in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in names:
            if name in SKIP_NAMES:
                continue
            full = os.path.join(base, name)
            out.append((os.path.relpath(full, ROOT).replace(os.sep, "/"), full))
    return sorted(out)


def main() -> int:
    changed = 0
    for rel, full in files_to_consider(sys.argv[1:]):
        with open(full, "rb") as fh:
            local = fh.read()
        remote, sha = remote_bytes(rel)
        if remote == local:
            continue
        payload = {
            "message": f"Update {rel}",
            "content": base64.b64encode(local).decode(),
        }
        if sha:
            payload["sha"] = sha
        api("PUT", f"/repos/{REPO}/contents/{rel}", payload)
        changed += 1
        print(f"updated {rel} ({len(local)} bytes)")
        time.sleep(0.4)
    print(f"{changed} file(s) updated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
