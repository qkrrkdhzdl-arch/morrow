#!/usr/bin/env bash
# Rebuild the checked-in directory store from seed/seed.cypher.
# Needs the Relate CLI: https://relatedb.ai/docs/get-started/install
#   RELATE_BIN=/path/to/relate bash scripts/build_store.sh
set -euo pipefail
RELATE="${RELATE_BIN:-relate}"
cd "$(dirname "$0")/.."

if ! command -v "$RELATE" >/dev/null 2>&1; then
  echo "relate CLI not found. Install it or set RELATE_BIN=<path to relate>." >&2
  exit 2
fi

rm -rf store/morrow
mkdir -p store
"$RELATE" query -d store/morrow --snapshot-format json < seed/seed.cypher
echo "--- nodes"
"$RELATE" -d store/morrow --markdown -c "MATCH (n) RETURN labels(n) AS label, count(*) AS nodes"
echo "--- indexes"
"$RELATE" -d store/morrow --markdown -c "SHOW INDEXES YIELD name, type, state RETURN name, type, state"
