# store/morrow — the inspected store

This is the persistent Relate store for the sample graph: a WAL plus one
`graph.json` snapshot (`--snapshot-format json`), written by
`scripts/build_store.sh` from `seed/seed.cypher`.

It exists so the graph can be read without a browser:

```bash
relate -d store/morrow -c "MATCH (n) RETURN labels(n) AS label, count(*) AS n"
relate -d store/morrow -c "SHOW INDEXES YIELD name, type, state RETURN name, type, state"
relate -d store/morrow --json -c "MATCH (o:Obligation)-[:NEEDS]->(a:Artifact) RETURN o.title, a.title LIMIT 5"
```

Dates in this snapshot are absolute, from the day it was built (2026-11-17). The
browser app builds the same graph with dates relative to the day it is opened, so
the sample never looks stale. Rebuild the snapshot with
`bash scripts/build_store.sh` after changing the generator.
