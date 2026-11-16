# The embedder, and why it is not a model

`scripts/embed.py` and `assets/embed.js` implement the same 128-dimension hashed
character-trigram vector:

1. lowercase, keep `[0-9a-z가-힣]+` runs as words;
2. for each word, emit the word itself and every 3-character shingle of `^word$`;
3. hash each shingle with FNV-1a 32-bit, add `±(1 + len/12)` to component
   `hash % 128`, sign taken from the top bit;
4. L2-normalise, round each component to six decimals.

That is it. `embed("record a pitch video for the competition")` returns a list of
128 numbers and takes microseconds.

## Why not a sentence-transformer

A real embedding model would be better at meaning. It would also add 20–100 MB of
weights, a first-paint download, a Web Worker loading a model, and — for the
hosted demo — a copy of the user's writing travelling to a server to be embedded.
Morrow's premise is that the deadlines and drafts stay in the tab. The trade-off
was made in that direction, and the limit is stated in the app: this matches
wording and morphology, not paraphrase. "Pitch video" and "record a clip for the
competition" land close; "investor update" and "monthly report" do not.

## Keeping the two implementations honest

Two implementations of one hash in two languages will drift. The seed therefore
carries Python-computed vectors, and the app recomputes three of them on load:

```js
const worst = Math.max(...sample.artifacts.slice(0, 3).map((a) => maxDiff(embed(a.text), a.vec)));
if (!(worst < 1e-9)) throw new Error(`seed vectors do not match the in-page embedder (max diff ${worst})`);
```

If they disagree by even one rounding step, seeding refuses and the status bar
says so, rather than building an index where the query lives in a different
vector space from the stored rows.

## What it is good enough for

On the sample graph, a query built from the pitch-video brief returns, in order:

| Artifact | Cosine | Claimed by |
|---|---|---|
| Pitch video script | 0.773 | IR pitch video submission |
| Pitch deck v4 | 0.701 | IR pitch video, Conference talk, Investor deck |
| Review photo set | 0.659 | three review campaigns |

The first two are the right answer. The third is there because "photo" and
"video" share shingles and the sample has few artifacts; at fifty artifacts the
tail would be crowded out by real neighbours. This is a demonstration of the
mechanism, not a benchmark.
