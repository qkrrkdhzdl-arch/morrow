// Deterministic 128-dimension hashed character-trigram embedder.
// Mirror of scripts/embed.py. The seed file carries Python-computed vectors;
// on load the app recomputes two of them and refuses the seed if they differ,
// so a drift between the two implementations cannot go unnoticed.

export const DIM = 128;

const TOKEN_RE = /[0-9a-z가-힣]+/g;

export function fnv1a32(text) {
  let h = 0x811c9dc5;
  const bytes = new TextEncoder().encode(text);
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function* tokens(text) {
  const words = String(text || "").toLowerCase().match(TOKEN_RE) || [];
  for (const word of words) {
    yield word;
    const padded = `^${word}$`;
    for (let i = 0; i + 3 <= padded.length; i += 1) {
      yield padded.slice(i, i + 3);
    }
  }
}

export function embed(text) {
  const vec = new Float64Array(DIM);
  for (const token of tokens(text)) {
    const h = fnv1a32(token);
    const idx = h % DIM;
    const sign = ((h >>> 31) & 1) ? -1 : 1;
    const weight = 1 + token.length / 12;
    vec[idx] += sign * weight;
  }
  let norm = 0;
  for (let i = 0; i < DIM; i += 1) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  const out = [];
  for (let i = 0; i < DIM; i += 1) {
    out.push(norm === 0 ? 0 : Number((vec[i] / norm).toFixed(6)));
  }
  return out;
}

/** Compare a recomputed vector with the one stored in the seed. */
export function maxDiff(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let worst = 0;
  for (let i = 0; i < a.length; i += 1) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
}
