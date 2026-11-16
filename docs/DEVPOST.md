# Devpost submission — Morrow

**Project name:** Morrow
**Tagline:** A deadline graph, not a to-do list.
**Try it:** https://qkrrkdhzdl-arch.github.io/morrow/
**Video (62s):** https://github.com/qkrrkdhzdl-arch/morrow/blob/main/docs/morrow-demo.mp4
**Repository:** https://github.com/qkrrkdhzdl-arch/morrow

---

## About the project

### The thing I actually had trouble with

I am one person running a small studio. In a normal fortnight I owe a pitch video, a scholarship form, three review campaigns, a grant application, a VAT return, a client proposal, a conference talk and a newsletter. Nineteen deadlines, eighteen artifacts, one pair of hands.

The deadlines are not independent. The same pitch deck feeds the video and the talk. One photo set serves three campaigns. The portfolio is claimed by a scholarship and by an award entry. And the bank certificate — twenty minutes of work — is the only thing standing between me and two payments that are worth four figures each.

Every to-do app renders this as nineteen rows, and that view is wrong in both directions. It **over-counts** the work (three rows say "photos") so the week looks impossible, and it **hides the real blockage**, because a row does not show that a 20-minute item is holding up two payments.

### What Morrow does

Morrow keeps the relationships as relationships and answers three questions a list cannot:

1. **Which deadlines cannot be met at this capacity?** Work is placed earliest-deadline-first over the days that remain. The app reports the shortfall in minutes rather than a vague "busy" colour.
2. **Which artifact pays for itself several times?** Every artifact claimed by two or more open deadlines is listed with the deadlines that claim it — and the planner charges it **once**, to the earliest claimant. That single rule is the difference between "29h 16m of work" and the 40+ hours a list would claim.
3. **What does starting this drag in?** Selecting an artifact shows the deadlines waiting on it and, for each, what else that deadline still needs. Fixing the bank certificate unblocks two applications and drags a business plan and a portfolio in behind it — better to know that on day one than on day eleven.

The sample graph is my own fortnight with the titles generalised, and every date is an offset from the day you open the app, so it never looks stale.

### How Relate is used

**Mode: the WebAssembly build in a dedicated worker, with a durable OPFS store** (`opfs://morrow`), plus a **directory store** checked into the repository (`store/morrow/`, JSON snapshot) so a judge can open the same graph with the CLI without a browser.

Why Relate and not SQLite or a JSON file: the three questions above are traversals.

```cypher
// which artifact is claimed by several open deadlines
MATCH (o:Obligation)-[n:NEEDS]->(a:Artifact)
WHERE o.status = 'open' AND a.status <> 'ready'
WITH a, collect(DISTINCT o.title) AS deadlines
WHERE size(deadlines) >= 2
RETURN a.title, a.minutes_left, size(deadlines) AS claims, deadlines
ORDER BY claims DESC, minutes DESC
```

and the search box combines a vector index with a traversal **in one statement**, so "have I written something like this proposal before?" returns the artifact *and* who is waiting on it:

```cypher
MATCH (a:Artifact)
SEARCH a IN (VECTOR INDEX artifact_brief FOR $vec LIMIT $k) SCORE AS score
MATCH (o:Obligation)-[:NEEDS]->(a)
WHERE o.status = 'open'
RETURN a.title, round(score, 3), collect(DISTINCT o.title) ORDER BY score DESC
```

Relate capabilities in use: uniqueness constraints, a 128-dimension cosine **vector index**, a **full-text index**, the `SEARCH` clause, **variable-length traversal** (`DEPENDS_ON*1..3`) in both directions, aggregation over distinct paths, parameterised writes, `executeScript` for the schema, the WASM build, and the **OPFS durable store** in a worker. `docs/CLI.txt` is the real `SHOW INDEXES` output from the checked-in store.

I did not want a server: the deadlines, the drafts and the amounts are the user's, and a hosted copy of this page should not be their owner. Relate's embedded mode is what makes that possible without giving up Cypher.

### What is computed where

The split is visible in the app's Cypher log, so no number is a black box:

- **Cypher** answers the graph questions — what claims what, what is shared, what is downstream, what is similar. Every statement is in `cypher/queries.json`; the app fetches that file and `scripts/verify_queries.py` runs the same file against `store/morrow`, so the app and the CLI cannot drift.
- **`assets/planner.js`** answers the arithmetic question: given a capacity per day, can this work be placed in the days that remain? Greedy earliest-deadline-first, shared artifacts counted once.
- **The assistant** (optional, bring your own key) may only choose among **six tools**. It never sends Cypher, so a bad completion can pick the wrong question but cannot rewrite the answer. Writes stop at an in-page confirmation.

### What did not work, and what is not done

- **A trained embedding model.** The 128-dimension vector is a hashed character-trigram sketch, not a sentence transformer. It was chosen so the first paint needs no download and no server; the cost is that it matches wording and morphology rather than paraphrase. `docs/EMBEDDING.md` states the trade-off and shows where it fails.
- **A real optimiser.** The planner is greedy. It will not reshuffle to squeeze in one more deadline; it tells you the shortfall and stops. A proper interval-scheduling formulation with release dates would beat it, and that is the obvious next step.
- **Live calendars.** No import from Google or Apple Calendar, and deleting a deadline is still a Cypher statement rather than a button. `add_deadline` and `mark_ready` are the only editing paths.
- **Two implementations of one hash.** The Python generator and the browser must produce identical vectors; they did not on the first deploy (the sign bit was inverted in the JavaScript). The app now recomputes three seed vectors on load and refuses to index if they differ — the guard exists because the bug happened.

### Built with

Relate 1.0.2 (`@relate/relate-wasm`, vendored), Cypher 25, OPFS, vanilla ES modules, hand-drawn SVG, Python for the generator and the store build. No framework, no bundler, no CDN, no analytics, no fonts fetched at runtime.

AI tools: Claude (as a coding assistant) for CSS drafting and a review of the scheduling logic; every Cypher statement was written and verified against the real CLI. The in-app assistant uses whatever OpenAI-compatible endpoint the visitor configures — the app ships no key and costs the host nothing.
