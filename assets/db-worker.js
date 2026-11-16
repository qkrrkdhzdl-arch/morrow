// Dedicated worker: hosts the Relate database so the durable OPFS store can open.
// FileSystemSyncAccessHandle, which Relate's OPFS store needs, is only available
// in a dedicated worker, not on the page thread.

import init, { RelateDb } from "./vendor/relate/relate.js";
import { parseEnvelope } from "./db.js?v=9";

let db = null;
let mode = "unopened";

async function boot() {
  if (db) return mode;
  await init(new URL("./vendor/relate/relate_bg.wasm", import.meta.url));
  try {
    db = await RelateDb.open("opfs://morrow");
    mode = "durable OPFS store";
  } catch (err) {
    // OPFS can be refused (private mode, older browsers). Keep working, say so.
    db = new RelateDb();
    mode = `memory in worker, not persisted (${err && err.message ? err.message : err})`;
  }
  return mode;
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  try {
    if (msg.type === "init") {
      const started = performance.now();
      const m = await boot();
      self.postMessage({ id: msg.id, type: "ready", mode: m, ms: performance.now() - started });
      return;
    }
    if (msg.type === "query") {
      await boot();
      const env = parseEnvelope(db.execute(msg.cypher, msg.params ? JSON.stringify(msg.params) : null));
      self.postMessage({ id: msg.id, type: "result", rows: env.rows, columns: env.columns, ms: env.ms, error: env.error || null });
      return;
    }
    if (msg.type === "script") {
      await boot();
      const envelopes = db.executeScript(msg.cypher, null);
      let ms = 0;
      const rows = [];
      for (const raw of envelopes) {
        const env = parseEnvelope(raw);
        if (env.error) {
          self.postMessage({ id: msg.id, type: "result", rows: [], ms, error: env.error });
          return;
        }
        ms += env.ms || 0;
        rows.push(...(env.rows || []));
      }
      self.postMessage({ id: msg.id, type: "result", rows, ms, error: null });
      return;
    }
    self.postMessage({ id: msg.id, type: "error", message: `unknown message ${msg.type}` });
  } catch (err) {
    self.postMessage({ id: msg.id, type: "error", message: err && err.message ? err.message : String(err) });
  }
};
