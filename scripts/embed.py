#!/usr/bin/env python3
"""Deterministic 128-dimension hashed character-trigram embedder.

The same algorithm is implemented in assets/embed.js. Both must produce
identical vectors: the seed file carries the Python-computed vectors, and the
browser recomputes them on load and refuses the seed if they disagree.

Why not a real model: the point of the sample store is that it opens with no
network, no key and no download. Anything larger would make the first paint
depend on a 100 MB model fetch. docs/EMBEDDING.md states the trade-off.
"""
from __future__ import annotations

import math
import re
from typing import Iterable

DIM = 128
TOKEN_RE = re.compile(r"[0-9a-z가-힣]+")


def fnv1a32(text: str) -> int:
    h = 0x811C9DC5
    for byte in text.encode("utf-8"):
        h ^= byte
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def _tokens(text: str) -> Iterable[str]:
    for word in TOKEN_RE.findall(text.lower()):
        yield word
        # character trigrams over the word, with boundary markers
        padded = f"^{word}$"
        for i in range(len(padded) - 2):
            yield padded[i : i + 3]


def embed(text: str) -> list[float]:
    vec = [0.0] * DIM
    for token in _tokens(text or ""):
        h = fnv1a32(token)
        idx = h % DIM
        sign = 1.0 if (h >> 31) & 1 else -1.0
        weight = 1.0 + (len(token) / 12.0)
        vec[idx] += sign * weight
    norm = math.sqrt(sum(v * v for v in vec))
    if norm == 0.0:
        return vec
    return [round(v / norm, 6) for v in vec]


if __name__ == "__main__":
    import json
    import sys

    text = " ".join(sys.argv[1:]) or "deadline"
    print(json.dumps(embed(text)))
