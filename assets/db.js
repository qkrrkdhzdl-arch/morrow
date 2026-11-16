// The database front end.
//
// Relate's durable browser store (opfs://) only opens in a dedicated worker,
// so the worker is the normal path. If a worker cannot start at all, the app
// falls back to an in-memory database on the page thread and says so in the
// status bar: the analysis still runs, the data just does not survive a reload.
//
// Every statement goes through run(), which times it and hands the query text to
// the onLog callback. That is why the Cypher log can show the real statements
// the interface used instead of a rewritten summary.

const WORKER_URL = new URL("./db-worker.js", import.meta.url);

export class Graph {
  constructor({ onLog } = {}) {
    this.backend = null;
    this.mode = "unopened";
    this.onLog = onLog || (() => {});
    this.seq = 0;
  }

  async open() {
    try {
      this.backend = await WorkerBackend.start();
      this.mode = this.backend.mode;
    } catch (err) {
      console.warn("worker unavailable, using the page thread", err);
      this.backend = await InlineBackend.start();
      this.mode = this.backend.mode;
      this.degradedBecause = err && err.message ? err.message : String(err);
    }
    return this.mode;
  }

  async run(cypher, params = null, source = "ui") {
    const started = performance.now();
    const out = await this.backend.query(cypher, params);
    const ms = typeof out.ms === "number" ? out.ms : performance.now() - started;
    this.onLog({ source, cypher, ms, error: out.error || null, rows: (out.rows || []).length });
    if (out.error) {
      const err = new Error(out.error);
      err.cypher = cypher;
      throw err;
    }
    return out;
  }

  async script(cypher, source = "seed") {
    const started = performance.now();
    const out = await this.backend.script(cypher);
    const ms = typeof out.ms === "number" ? out.ms : performance.now() - started;
    this.onLog({ source, cypher, ms, error: out.error || null, rows: 0 });
    if (out.error) throw new Error(out.error);
    return out;
  }

  close() {
    if (this.backend && this.backend.close) this.backend.close();
  }
}

class WorkerBackend {
  static async start() {
    if (typeof Worker === "undefined") throw new Error("no Worker in this browser");
    const worker = new Worker(WORKER_URL, { type: "module" });
    const be = new WorkerBackend(worker);
    const mode = await be.handshake();
    be.mode = mode;
    return be;
  }

  constructor(worker) {
    this.worker = worker;
    this.mode = "worker";
    this.pending = new Map();
    this.seq = 0;
    worker.onmessage = (event) => {
      const msg = event.data || {};
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.type === "error") entry.reject(new Error(msg.message || "worker error"));
      else entry.resolve(msg);
    };
    worker.onerror = (event) => {
      for (const entry of this.pending.values()) entry.reject(new Error(event.message || "worker crashed"));
      this.pending.clear();
    };
  }

  handshake() {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => reject(new Error("worker did not start in 20s")), 20000);
      this.pending.set(id, {
        resolve: (msg) => { clearTimeout(timer); resolve(msg.mode); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
      this.worker.postMessage({ id, type: "init" });
    });
  }

  query(cypher, params) {
    return this.call({ type: "query", cypher, params });
  }

  script(cypher) {
    return this.call({ type: "script", cypher });
  }

  call(payload) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...payload });
    });
  }

  close() {
    if (this.worker) this.worker.terminate();
  }
}

class InlineBackend {
  static async start() {
    const mod = await import("./vendor/relate/relate.js");
    await mod.default(new URL("./vendor/relate/relate_bg.wasm", import.meta.url));
    const db = new mod.RelateDb();
    const be = new InlineBackend(db);
    return be;
  }

  constructor(db) {
    this.db = db;
    this.mode = "memory (page thread, not persisted)";
  }

  query(cypher, params) {
    return parseEnvelope(this.db.execute(cypher, params ? JSON.stringify(params) : null));
  }

  script(cypher) {
    const envelopes = this.db.executeScript(cypher, null);
    const rows = [];
    let ms = 0;
    for (const raw of envelopes) {
      const env = parseEnvelope(raw);
      if (env.error) return { rows: [], ms, error: env.error };
      ms += env.ms || 0;
      rows.push(...(env.rows || []));
    }
    return { rows, ms };
  }
}

export function parseEnvelope(raw) {
  let env;
  try {
    env = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    return { rows: [], error: `unreadable result: ${err.message}` };
  }
  if (!env || typeof env !== "object") return { rows: [], error: "empty result" };
  const ms = env.elapsed_ms ?? env.elapsedMs ?? (env.timings && env.timings.elapsed_ms) ?? null;
  if (env.error) {
    const message = typeof env.error === "string" ? env.error : env.error.message || JSON.stringify(env.error);
    return { rows: [], ms, error: message };
  }
  return { rows: env.rows || [], columns: env.columns || [], stats: env.stats || null, ms };
}
