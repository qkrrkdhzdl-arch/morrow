import { Graph } from "./db.js?v=6";
import { embed, maxDiff } from "./embed.js?v=6";
import { buildPlan, todayISO, addDays, daysBetween, shortDay, verdictOf, fmtMinutes } from "./planner.js?v=6";
import { renderGraph } from "./graph.js?v=6";
import { runAgent } from "./agent.js?v=6";

const BUILD = "2026-11-17.4";
const $ = (id) => document.getElementById(id);

let Q = {};   // cypher/queries.json, loaded at boot
let SCHEMA = ""; // cypher/schema.cypher

const state = {
  graph: null,
  mode: "",
  obligations: [],
  artifacts: [],
  needs: [],
  depends: [],
  leverage: [],
  collisions: [],
  plan: null,
  selected: null,
  graphView: null,
  chat: [],
  busy: false,
  logs: [],
};

async function loadStatements() {
  const [qres, sres] = await Promise.all([
    fetch("cypher/queries.json", { cache: "no-store" }),
    fetch("cypher/schema.cypher", { cache: "no-store" }),
  ]);
  if (!qres.ok) throw new Error("cypher/queries.json is missing");
  if (!sres.ok) throw new Error("cypher/schema.cypher is missing");
  const data = await qres.json();
  Q = { ...data.read, ...data.write };
  SCHEMA = await sres.text();
}

/* ------------------------------------------------------------------ status */

function setStore(text, level = "") {
  const dot = $("storeDot");
  dot.className = `dot ${level}`;
  $("storeText").textContent = text;
}

function pushLog(entry) {
  state.logs.push(entry);
  if (state.logs.length > 400) state.logs.shift();
  renderLogTail();
}

function renderLogTail() {
  const box = $("log");
  const withSeed = $("logSeed") && $("logSeed").checked;
  const shown = withSeed ? state.logs : state.logs.filter((entry) => entry.source !== "seed");
  const recent = shown.slice(-120).reverse();
  box.innerHTML = "";
  for (const entry of recent) {
    const line = document.createElement("div");
    line.className = `logline${entry.error ? " err" : ""}`;
    line.innerHTML = `<span class="src">${escapeHtml(entry.source)}</span><span class="q">${escapeHtml(entry.cypher)}${
      entry.error ? `<br><b>${escapeHtml(entry.error)}</b>` : ""
    }</span><span class="ms">${entry.ms ? `${Math.round(entry.ms)} ms` : "—"}</span>`;
    box.append(line);
  }
  $("logCount").textContent = String(shown.length);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ------------------------------------------------------------------- model */

async function loadModel() {
  const [obs, arts, needs, deps, lev, coll] = await Promise.all([
    state.graph.run(Q.obligations, null, "ui"),
    state.graph.run(Q.artifacts, null, "ui"),
    state.graph.run(Q.needs, null, "ui"),
    state.graph.run(Q.depends, null, "ui"),
    state.graph.run(Q.leverage, null, "ui"),
    state.graph.run(Q.collisions, null, "ui"),
  ]);
  state.obligations = obs.rows;
  state.artifacts = arts.rows;
  state.needs = needs.rows.map((r) => ({ ...r, weight: Number(r.weight) }));
  state.depends = deps.rows;
  state.leverage = lev.rows;
  state.collisions = coll.rows;
}

function capacity() {
  return Math.max(15, Number($("capacity").value) || 150);
}

function horizonDays() {
  return Number($("horizon").value) || 14;
}

function recompute() {
  state.plan = buildPlan({
    obligations: state.obligations,
    artifacts: state.artifacts,
    needs: state.needs,
    capacity: capacity(),
    today: todayISO(),
    horizonDays: horizonDays(),
  });
  renderAll();
}

/* ------------------------------------------------------------------ render */

function renderAll() {
  renderStats();
  renderTimeline();
  renderDayLoad();
  renderLeverage();
  renderGraphView();
}

function renderStats() {
  const s = state.plan.stats;
  setStat("statOpen", s.openInHorizon, `${state.collisions.length} clashing days`);
  setStat("statLoad", fmtMinutes(s.workRemaining), "shared work counted once");
  setStat("statFit", fmtMinutes(s.capacityAvailable), `${state.plan.capacity} min × ${state.plan.horizonDays} days`);
  setStat("statRisk", s.infeasible, s.infeasible ? `${fmtMinutes(s.shortfall)} short` : "all fit", s.infeasible ? "risk" : "ok");
  setStat("statLeverage", s.sharedArtifacts, "build once, satisfy several", s.sharedArtifacts ? "ok" : "");
}

function setStat(id, value, sub, cls = "") {
  const box = $(id);
  box.className = `stat ${cls}`;
  box.querySelector(".v").textContent = value;
  box.querySelector(".sub").textContent = sub;
}

function renderTimeline() {
  const box = $("timeline");
  box.innerHTML = "";
  const span = state.plan.horizonDays;
  for (const item of state.plan.ordered) {
    const v = verdictOf(item);
    const row = document.createElement("div");
    row.className = `row${state.selected === item.ob.id ? " sel" : ""}`;
    row.dataset.id = item.ob.id;
    // A Gantt strip: the bar runs from today to the day the portal closes, so the
    // clusters (three deadlines on one day) are visible as bars of equal length.
    const end = item.late ? 0 : Math.min(100, ((item.daysLeft + 1) / span) * 100);
    const ratio = item.demandPerDay / Math.max(1, state.plan.capacity);
    const fillCls = !item.feasible ? "over" : ratio > 0.85 ? "warn" : "";
    row.innerHTML = `
      <div class="name">
        <b>${escapeHtml(item.ob.title)}</b>
        <span>${escapeHtml(item.ob.due)} · ${escapeHtml(item.ob.channel)}</span>
      </div>
      <div class="track" title="${item.demandPerDay} min/day against a capacity of ${state.plan.capacity} min/day">
        <span class="fill ${fillCls}" style="width:${end.toFixed(1)}%"></span>
      </div>
      <div class="days">${item.daysLeft < 0 ? `${-item.daysLeft}d late` : item.daysLeft === 0 ? "today" : `${item.daysLeft}d`}</div>
      <div class="scale"><span class="${v.cls}">${escapeHtml(v.label)}</span><br><span style="color:var(--ink-3)">${fmtMinutes(item.unit)}</span></div>`;
    row.addEventListener("click", () => select("obligation", item.ob.id));
    box.append(row);
  }
}

function renderDayLoad() {
  const box = $("dayload");
  box.innerHTML = "";
  const days = state.plan.days;
  const peak = Math.max(state.plan.capacity, ...days.map((d) => d.demand));
  for (const day of days) {
    const cell = document.createElement("div");
    cell.className = "daycell";
    const h = Math.max(2, (day.demand / peak) * 100);
    const cls = day.demand > day.capacity ? "over" : day.ratio > 0.85 ? "warn" : "";
    cell.innerHTML = `
      <div class="bar" title="${day.date}: ${day.demand} of ${day.capacity} min">
        <i class="${cls}" style="height:${h.toFixed(1)}%"></i>
      </div>
      <div class="lbl">${shortDay(day.date)}</div>`;
    box.append(cell);
  }
}

function renderLeverage() {
  const box = $("leverage");
  box.innerHTML = "";
  if (state.leverage.length === 0) {
    box.innerHTML = `<p class="hint">No artifact is claimed by two open deadlines right now. Add one, or widen the horizon.</p>`;
    return;
  }
  for (const item of state.leverage) {
    const card = document.createElement("div");
    card.className = "lev";
    const titles = item.deadlines || [];
    card.innerHTML = `
      <div class="t"><b>${escapeHtml(item.artifact)}</b><span class="n">${item.claims}×</span></div>
      <div class="m">${item.status === "missing" ? "not started" : item.status} · ${fmtMinutes(item.minutes)} left · counted once</div>
      <ul>${titles.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`;
    card.addEventListener("click", () => select("artifact", item.id));
    box.append(card);
  }
}

function renderGraphView() {
  const svg = $("graph");
  state.graphView = renderGraph(
    svg,
    { obligations: state.obligations, artifacts: state.artifacts, needs: state.needs, depends: state.depends },
    { onSelect: (kind, id) => select(kind, id) }
  );
  if (state.selected) state.graphView.focus(state.selected);
}

/* --------------------------------------------------------------- selecting */

async function select(kind, id) {
  state.selected = id;
  renderTimeline();
  if (state.graphView) state.graphView.focus(id);
  const box = $("inspector");
  box.innerHTML = `<p class="empty">Reading the graph…</p>`;
  try {
    if (kind === "artifact") await inspectArtifact(id);
    else await inspectObligation(id);
  } catch (err) {
    box.innerHTML = `<p class="empty">Could not read this node: ${escapeHtml(err.message)}</p>`;
  }
}

async function inspectArtifact(id) {
  const art = state.artifacts.find((a) => a.id === id);
  const [claims, ripple, deps, down] = await Promise.all([
    state.graph.run(Q.artifactClaims, { id }, "inspector"),
    state.graph.run(Q.artifactRipple, { id }, "inspector"),
    state.graph.run(Q.artifactDeps, { id }, "inspector"),
    state.graph.run(Q.artifactDownstream, { id }, "inspector"),
  ]);
  const box = $("inspector");
  const plan = state.plan.artifactPlan.get(id);
  box.innerHTML = `
    <h3>${escapeHtml(art ? art.title : id)}</h3>
    <p class="meta">${escapeHtml(art ? `${art.kind} · ${art.status} · ${fmtMinutes(art.minutes_left)} left` : id)}</p>
    <dl class="kv">
      <dt>Claimed by</dt><dd>${claims.rows.length} deadline${claims.rows.length === 1 ? "" : "s"}</dd>
      <dt>Counted as</dt><dd>${plan ? `${fmtMinutes(plan.minutes)} once` : "not in horizon"}</dd>
      <dt>Feeds</dt><dd>${down.rows.length ? down.rows.map((r) => escapeHtml(r.feeds)).join(", ") : "nothing further"}</dd>
      <dt>Needs first</dt><dd>${deps.rows.length ? deps.rows.map((r) => `${escapeHtml(r.needs_first)} (${escapeHtml(r.status)})`).join(", ") : "nothing"}</dd>
    </dl>
    <p class="meta">Deadlines that claim it</p>
    <ul>${claims.rows.map((r) => `<li>${escapeHtml(r.deadline)} · ${escapeHtml(r.due)}</li>`).join("") || "<li>none</li>"}</ul>
    ${
      ripple.rows.length
        ? `<p class="meta">Fixing this unblocks, but also drags in</p>
           <ul>${ripple.rows
             .map((r) => `<li>${escapeHtml(r.deadline)} → ${escapeHtml((r.also_needed || []).join(", "))}</li>`)
             .join("")}</ul>`
        : ""
    }
    <details><summary class="meta">Cypher used</summary><pre class="cy">${escapeHtml(Q.artifactRipple)}</pre></details>`;
}

async function inspectObligation(id) {
  const ob = state.obligations.find((o) => o.id === id);
  const [needs, shared] = await Promise.all([
    state.graph.run(Q.obligationNeeds, { id }, "inspector"),
    state.graph.run(Q.obligationShared, { id }, "inspector"),
  ]);
  const item = state.plan.items.find((i) => i.ob.id === id);
  const box = $("inspector");
  box.innerHTML = `
    <h3>${escapeHtml(ob ? ob.title : id)}</h3>
    <p class="meta">${escapeHtml(ob ? `${ob.due} · ${ob.channel} · ${ob.stake || ""}` : id)}</p>
    <p>${escapeHtml(ob ? ob.brief : "")}</p>
    <dl class="kv">
      <dt>Work left</dt><dd>${item ? `${fmtMinutes(item.unit)} (${fmtMinutes(item.ownMinutes)} own + ${fmtMinutes(item.artifactMinutes)} artifacts)` : "outside horizon"}</dd>
      <dt>Per day</dt><dd>${item ? `${item.demandPerDay} min over ${item.availableDays} day${item.availableDays === 1 ? "" : "s"}` : "—"}</dd>
      <dt>Verdict</dt><dd>${item ? escapeHtml(verdictOf(item).label) : "—"}</dd>
    </dl>
    <p class="meta">Needs</p>
    <ul>${needs.rows
      .map((r) => `<li>${escapeHtml(r.artifact)} · ${r.status === "ready" ? "ready" : `${r.status}, ${fmtMinutes(r.minutes_left)} left`} · share ${r.share}</li>`)
      .join("") || "<li>nothing — this one is only my own time</li>"}</ul>
    ${
      shared.rows.length
        ? `<p class="meta">Shared with other deadlines</p>
           <ul>${shared.rows
             .map((r) => `<li>${escapeHtml(r.artifact)} → ${escapeHtml((r.also_claimed_by || []).join(", "))}</li>`)
             .join("")}</ul>`
        : ""
    }
    <details><summary class="meta">Cypher used</summary><pre class="cy">${escapeHtml(Q.obligationShared)}</pre></details>`;
}

/* ------------------------------------------------------------------ seeding */

async function wipe() {
  await state.graph.run(Q.wipe, null, "reset");
}

async function seedSample() {
  const response = await fetch("seed/sample.json", { cache: "no-store" });
  if (!response.ok) throw new Error("seed/sample.json is missing");
  const sample = await response.json();

  // The Python generator and the browser must agree on the embedder, or the
  // vector index is comparing vectors from two different spaces.
  const worst = Math.max(...sample.artifacts.slice(0, 3).map((a) => maxDiff(embed(a.text), a.vec)));
  if (!(worst < 1e-9)) throw new Error(`seed vectors do not match the in-page embedder (max diff ${worst})`);

  await wipe();
  await state.graph.script(SCHEMA, "schema");
  const today = todayISO();
  for (const o of sample.obligations) {
    await state.graph.run(
      Q.addObligationSeed,
      { id: o.id, title: o.title, due: addDays(today, o.due_in), minutes: o.minutes, channel: o.channel, stake: o.stake, brief: o.brief },
      "seed"
    );
  }
  for (const a of sample.artifacts) {
    await state.graph.run(
      Q.addArtifact,
      { id: a.id, title: a.title, kind: a.kind, status: a.status, minutes_left: a.minutes_left, text: a.text, vec: a.vec },
      "seed"
    );
  }
  for (const n of sample.needs) {
    await state.graph.run(
      Q.addNeed,
      { id: n.obligation, obligation: n.obligation, artifact: n.artifact, weight: n.weight },
      "seed"
    );
  }
  for (const d of sample.depends) {
    await state.graph.run(
      Q.addDependency,
      { artifact: d.artifact, on: d.on },
      "seed"
    );
  }
  await state.graph.run(Q.addMeta, { today }, "seed");
  return today;
}

async function sampleAge() {
  try {
    const { rows } = await state.graph.run(Q.meta, null, "meta");
    if (!rows.length) return null;
    return daysBetween(rows[0].day, todayISO());
  } catch (err) {
    return null;
  }
}

/* -------------------------------------------------------------------- agent */

const TOOLS = [
  {
    type: "function",
    function: {
      name: "plan_overview",
      description: "The current deterministic plan: deadlines inside the horizon, minutes each one still needs, which are infeasible and by how much.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "shared_artifacts",
      description: "Artifacts that two or more open deadlines need, with how many deadlines claim each and its remaining minutes.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "similar_artifacts",
      description: "Search existing artifacts by meaning (vector index) and return the open deadlines that claim each hit.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "What you are about to write, in one or two sentences." },
          k: { type: "integer", description: "How many neighbors, 1-8.", default: 3 },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "unblocks",
      description: "Given one artifact, the deadlines that claim it and what else each of those deadlines still needs.",
      parameters: { type: "object", properties: { artifact_id: { type: "string" } }, required: ["artifact_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_ready",
      description: "Mark an artifact finished and set its remaining minutes to zero. Asks the user first.",
      parameters: { type: "object", properties: { artifact_id: { type: "string" } }, required: ["artifact_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "add_deadline",
      description: "Add a deadline with its own minutes and the artifacts it needs. Asks the user first.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          due: { type: "string", description: "YYYY-MM-DD" },
          minutes: { type: "integer" },
          channel: { type: "string", description: "contest, grant, campaign, admin, client, content, investor, launch, talk" },
          brief: { type: "string" },
          needs: {
            type: "array",
            items: {
              type: "object",
              properties: { artifact_id: { type: "string" }, weight: { type: "number" } },
              required: ["artifact_id"],
            },
          },
        },
        required: ["title", "due", "minutes"],
      },
    },
  },
];

function planForAgent() {
  return state.plan.ordered.map((i) => ({
    deadline: i.ob.title,
    due: i.ob.due,
    channel: i.ob.channel,
    own_minutes: i.ownMinutes,
    artifact_minutes: i.artifactMinutes,
    minutes_left: i.unit,
    per_day: i.demandPerDay,
    days_left: i.daysLeft,
    feasible: i.feasible,
    short_by: i.shortfall,
    shared_artifacts: i.shared,
  }));
}

async function callTool(name, args) {
  if (name === "plan_overview") {
    return {
      capacity_per_day: state.plan.capacity,
      horizon_days: state.plan.horizonDays,
      stats: state.plan.stats,
      deadlines: planForAgent(),
      day_pressure: state.plan.days.map((d) => ({ date: d.date, demand: d.demand, capacity: d.capacity })),
    };
  }
  if (name === "shared_artifacts") {
    const { rows } = await state.graph.run(Q.leverage, null, "agent");
    return { artifacts: rows };
  }
  if (name === "similar_artifacts") {
    const text = String(args.text || "");
    const k = Math.min(8, Math.max(1, Number(args.k) || 3));
    const { rows } = await state.graph.run(Q.similar, { vec: embed(text), k }, "agent");
    return { query: text, hits: rows };
  }
  if (name === "unblocks") {
    const { rows } = await state.graph.run(Q.unblocks, { id: String(args.artifact_id || "") }, "agent");
    return { rows };
  }
  if (name === "mark_ready") {
    const id = String(args.artifact_id || "");
    const art = state.artifacts.find((a) => a.id === id);
    if (!art) return { error: `no artifact ${id}` };
    const ok = await confirmInline(`Mark “${art.title}” finished and set its remaining minutes to zero?`);
    if (!ok) return { cancelled: true };
    await state.graph.run(Q.markReady, { id }, "agent-write");
    await refresh();
    return { done: true, artifact: art.title };
  }
  if (name === "add_deadline") {
    const title = String(args.title || "").trim();
    const due = String(args.due || "").trim();
    const minutes = Math.max(0, Math.round(Number(args.minutes) || 0));
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return { error: "title and due (YYYY-MM-DD) are required" };
    const ok = await confirmInline(`Add “${title}”, due ${due}, ${minutes} minutes?`);
    if (!ok) return { cancelled: true };
    const id = `ob-${Date.now().toString(36)}`;
    await state.graph.run(
      Q.addDeadline,
      { id, title, due, minutes, channel: String(args.channel || "admin"), brief: String(args.brief || "") },
      "agent-write"
    );
    for (const need of Array.isArray(args.needs) ? args.needs : []) {
      const artifact = String(need.artifact_id || "");
      if (!artifact) continue;
      await state.graph.run(
        Q.addNeed,
        { id, obligation: id, artifact, weight: Number(need.weight) || 1 },
        "agent-write"
      );
    }
    await refresh();
    return { done: true, id, title };
  }
  return { error: `unknown tool ${name}` };
}

function llmSettings() {
  const key = sessionStorage.getItem("morrow.key") || "";
  return {
    baseUrl: $("llmBase").value.trim() || "https://api.openai.com/v1",
    model: $("llmModel").value.trim() || "gpt-4o-mini",
    apiKey: key,
  };
}

async function ask(question) {
  if (state.busy) return;
  const settings = llmSettings();
  if (!settings.apiKey) {
    addMessage("sys", "No model key set. Open “Model settings” to add one — the plan above does not need it.");
    return;
  }
  state.busy = true;
  addMessage("user", question);
  state.chat.push({ role: "user", content: question });
  try {
    const { messages } = await runAgent({
      ...settings,
      history: state.chat.slice(-8),
      tools: TOOLS,
      callTool,
      onAssistant: (text) => {
        addMessage("bot", text);
        state.chat.push({ role: "assistant", content: text });
      },
      onTool: (event) => {
        if (event.phase === "start") addToolCard(event.name, event.args, null, "running");
        else updateToolCard(event.result);
      },
    });
    state.chat = messages.filter((m) => m.role === "user" || (m.role === "assistant" && m.content));
  } catch (err) {
    addMessage("sys", `Model error: ${err.message}`);
  } finally {
    state.busy = false;
  }
}

function addMessage(kind, text) {
  const box = $("chat");
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  div.textContent = text;
  box.append(div);
  box.scrollTop = box.scrollHeight;
}

let lastToolCard = null;
function addToolCard(name, args, result, stateLabel) {
  const box = $("chat");
  const div = document.createElement("div");
  div.className = "tool";
  div.innerHTML = `<div class="th"><b>${escapeHtml(name)}</b><span>${escapeHtml(JSON.stringify(args || {}).slice(0, 120))}</span></div><pre>${escapeHtml(result ? JSON.stringify(result).slice(0, 900) : stateLabel || "")}</pre>`;
  box.append(div);
  box.scrollTop = box.scrollHeight;
  lastToolCard = div;
}

function updateToolCard(result) {
  if (!lastToolCard) return;
  const pre = lastToolCard.querySelector("pre");
  pre.textContent = JSON.stringify(result, null, 1).slice(0, 1200);
}

function confirmInline(question) {
  return new Promise((resolve) => {
    const box = $("chat");
    const div = document.createElement("div");
    div.className = "tool";
    div.innerHTML = `<div class="th"><b>confirm</b><span>${escapeHtml(question)}</span></div>`;
    const actions = document.createElement("div");
    actions.className = "suggestions";
    const yes = document.createElement("button");
    yes.className = "chip";
    yes.textContent = "Yes, do it";
    const no = document.createElement("button");
    no.className = "chip";
    no.textContent = "Cancel";
    yes.addEventListener("click", () => {
      div.remove();
      resolve(true);
    });
    no.addEventListener("click", () => {
      div.remove();
      resolve(false);
    });
    actions.append(yes, no);
    div.append(actions);
    box.append(div);
    box.scrollTop = box.scrollHeight;
  });
}

/* ----------------------------------------------------------------- controls */

async function refresh() {
  await loadModel();
  recompute();
}

function bind() {
  $("capacity").addEventListener("change", recompute);
  $("logSeed").addEventListener("change", renderLogTail);
  $("horizon").addEventListener("change", recompute);
  $("reseed").addEventListener("click", async () => {
    if (!confirm("Delete the stored graph and load the sample again?")) return;
    setStore("Re-seeding the sample…");
    try {
      const day = await seedSample();
      await refresh();
      setStore(`Sample re-seeded for ${day}. ${state.mode}`, "ok");
    } catch (err) {
      setStore(`Re-seed failed: ${err.message}`, "err");
    }
  });
  $("export").addEventListener("click", () => {
    const payload = {
      exported_at: new Date().toISOString(),
      capacity_minutes_per_day: capacity(),
      obligations: state.obligations,
      artifacts: state.artifacts.map(({ text, ...rest }) => rest),
      needs: state.needs,
      depends: state.depends,
    };
    const blob = new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `morrow-graph-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  $("redate").addEventListener("click", async () => {
    setStore("Re-dating the sample…");
    try {
      const day = await seedSample();
      await refresh();
      $("redate").classList.add("hidden");
      setStore(`Sample re-dated to ${day}. ${state.mode}`, "ok");
    } catch (err) {
      setStore(`Re-date failed: ${err.message}`, "err");
    }
  });
  $("askForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("askInput");
    const question = input.value.trim();
    if (!question) return;
    input.value = "";
    ask(question);
  });
  document.querySelectorAll("[data-q]").forEach((btn) => {
    btn.addEventListener("click", () => ask(btn.dataset.q));
  });
  const key = sessionStorage.getItem("morrow.key");
  if (key) {
    $("llmKey").value = key;
    $("llmState").textContent = "key set";
    $("llmState").classList.add("on");
  }
  $("llmKey").addEventListener("change", () => {
    const value = $("llmKey").value.trim();
    if (value) sessionStorage.setItem("morrow.key", value);
    else sessionStorage.removeItem("morrow.key");
    $("llmState").textContent = value ? "key set" : "no key";
    $("llmState").classList.toggle("on", Boolean(value));
  });
}

/* --------------------------------------------------------------------- boot */

async function boot() {
  try {
    await loadStatements();
  } catch (err) {
    setStore(`Could not load the statement file: ${err.message}`, "err");
    return;
  }
  state.graph = new Graph({ onLog: pushLog });
  setStore("Opening the graph…");
  try {
    const mode = await state.graph.open();
    state.mode = mode;
    $("engineLine").textContent = `relate 1.0.2 · ${mode} · build ${BUILD}`;
    window.__morrow = state;
    const { rows } = await state.graph.run(Q.count, null, "boot");
    const count = rows.length ? Number(rows[0].n) : 0;
    if (count === 0) {
      setStore("Empty store — writing the sample graph…");
      await seedSample();
    }
    await refresh();
    bind();
    const age = await sampleAge();
    if (age !== null && age >= 3) $("redate").classList.remove("hidden");
    const nodes = state.obligations.length + state.artifacts.length;
    setStore(
      `${nodes} nodes, ${state.needs.length + state.depends.length} relationships · ${mode}`,
      mode.startsWith("durable") ? "ok" : "warn"
    );
  } catch (err) {
    console.error(err);
    setStore(`Could not open the graph: ${err.message}`, "err");
  }
}

boot();
