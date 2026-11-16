# The graph

Three node labels and two relationship types. Small on purpose: every extra type
would be another thing the planner has to guess about.

```text
(:Obligation) -[:NEEDS {weight}]-> (:Artifact)
(:Artifact)   -[:DEPENDS_ON]->     (:Artifact)
(:Meta {id: "meta"})
```

## Obligation — a deadline

| Property | Type | Meaning |
|---|---|---|
| `id` | string, unique | stable key, e.g. `ob-ir-video` |
| `title` | string | what it is, as the person would say it |
| `due` | string `YYYY-MM-DD` | the day the portal closes |
| `minutes` | integer | the person's own time on this deadline, ignoring artifacts |
| `status` | string | `open` right now; the app reads only `open` |
| `channel` | string | `contest`, `grant`, `campaign`, `admin`, `client`, `content`, `investor`, `launch`, `talk` |
| `stake` | string | what it is worth, in the person's words |
| `brief` | string | one or two sentences of what has to be produced |

## Artifact — something that has to exist

| Property | Type | Meaning |
|---|---|---|
| `id` | string, unique | e.g. `art-review-photos` |
| `title` | string | the thing, not the task |
| `kind` | string | `doc`, `form`, `photo`, `video`, `data` |
| `status` | string | `ready`, `draft`, `missing` |
| `minutes_left` | integer | remaining work on the artifact itself; `0` when `ready` |
| `text` | string | what the artifact contains — the text the full-text index and the embedder read |
| `vec` | list of 128 floats | the hashed trigram vector, indexed by `artifact_brief` |

## NEEDS — the edge that carries the share

`weight` is the fraction of the artifact's remaining work this deadline requires.
`1.0` means it cannot be submitted without the whole thing; `0.3` means a slice
(one table from a rate card) is enough.

The planner then pays each artifact **once**, at `max(weight)` over the deadlines
claiming it, charged to the earliest of those deadlines. That is the whole reason
the model is a graph: a list would charge the same artifact twice, and the week
would look worse than it is.

## DEPENDS_ON — what has to exist first

`art-ir-video -[:DEPENDS_ON]-> art-ir-deck` reads "the recording cannot start
before the deck does". The app walks this both ways, up to three hops: what a
selected artifact needs first, and what it feeds.

## Indexes

```cypher
SHOW INDEXES
```

- `artifact_brief` — vector index on `Artifact.vec`, 128 dimensions, cosine.
- `artifact_text` — full-text index on `[Artifact.text, Artifact.title]`.
- `obligation_id`, `artifact_id` — uniqueness constraints.

## Invariants the generator keeps

- Every `NEEDS` edge points from an `Obligation` to an `Artifact`; the reverse
  direction is never stored, because it is the same edge.
- `minutes_left = 0` exactly when `status = 'ready'`.
- `DEPENDS_ON` is acyclic. `MATCH (a)-[:DEPENDS_ON*1..3]->(a)` returns nothing —
  worth checking after adding your own edges.
