// The deterministic planner.
//
// Division of labour, stated the same way in the README: Cypher answers the
// questions that are graph questions (what needs what, what serves several
// deadlines, what is downstream of a missing artifact). This file answers the
// arithmetic question the graph cannot: given a capacity per day, which of these
// deadlines can still be met, and by how much does the rest miss.
//
// The one thing worth reading twice is the shared-artifact rule. If three
// deadlines need the same photo set, the photo set is built once. Done naively,
// each deadline would claim the full cost and the week would look three times
// more crowded than it is — which is the mistake a to-do list makes.

export const DAY_MS = 86400000;

export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseDay(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(iso, n) {
  const dt = parseDay(iso);
  dt.setDate(dt.getDate() + n);
  return todayISO(dt);
}

export function daysBetween(fromISO, toISOValue) {
  return Math.round((parseDay(toISOValue) - parseDay(fromISO)) / DAY_MS);
}

export function shortDay(iso) {
  const dt = parseDay(iso);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

export function buildPlan({ obligations, artifacts, needs, capacity, today, horizonDays }) {
  const horizonEnd = addDays(today, horizonDays - 1);
  const artifactById = new Map(artifacts.map((a) => [a.id, a]));
  const open = obligations.filter((o) => o.status === "open");
  const inHorizon = open.filter((o) => o.due <= horizonEnd);

  // Which open deadline needs which artifact inside the horizon?
  const sharers = new Map(); // artifactId -> [{obligation, weight, due}]
  const obById = new Map(inHorizon.map((o) => [o.id, o]));
  const needsByOb = new Map();
  for (const n of needs) {
    if (!obById.has(n.obligation)) continue;
    const list = needsByOb.get(n.obligation) || [];
    list.push(n);
    needsByOb.set(n.obligation, list);
    if (!sharers.has(n.artifact)) sharers.set(n.artifact, []);
    sharers.get(n.artifact).push({ obligation: n.obligation, weight: Number(n.weight) || 1, due: obById.get(n.obligation).due });
  }

  // Cost of each artifact: its remaining work, paid once, by the earliest deadline that needs it.
  const artifactPlan = new Map(); // id -> {id, minutes, owner, sharers: [obId], maxWeight}
  for (const [artifactId, list] of sharers) {
    const art = artifactById.get(artifactId);
    if (!art) continue;
    const sorted = [...list].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
    const maxWeight = Math.max(...sorted.map((s) => s.weight));
    const minutes = art.status === "ready" ? 0 : Math.round((art.minutes_left || 0) * maxWeight);
    artifactPlan.set(artifactId, {
      id: artifactId,
      title: art.title,
      minutes,
      owner: sorted[0].obligation,
      sharers: sorted.map((s) => s.obligation),
      maxWeight,
      status: art.status,
    });
    art.plannedFor = sorted[0].obligation;
  }

  // Each deadline carries its own minutes plus the artifacts it is the earliest claimant of.
  const items = inHorizon.map((ob) => {
    const ownMinutes = Number(ob.minutes) || 0;
    let artifactMinutes = 0;
    const shared = [];
    for (const n of needsByOb.get(ob.id) || []) {
      const plan = artifactPlan.get(n.artifact);
      if (!plan) continue;
      if (plan.owner === ob.id) artifactMinutes += plan.minutes;
      else if (plan.minutes > 0 && plan.sharers.includes(ob.id)) shared.push(plan.id);
    }
    const daysLeft = daysBetween(today, ob.due);
    const availableDays = Math.max(1, daysLeft + 1);
    const unit = ownMinutes + artifactMinutes;
    return {
      ob,
      ownMinutes,
      artifactMinutes,
      unit,
      daysLeft,
      availableDays,
      late: daysLeft < 0,
      shared,
      demandPerDay: Math.round(unit / availableDays),
    };
  });

  // Earliest-deadline-first feasibility: can the work actually be placed in the
  // days that remain, one person, one capacity per day?
  const remaining = new Map();
  for (let i = 0; i < horizonDays; i += 1) remaining.set(addDays(today, i), capacity);
  const dayDemand = new Map();
  for (let i = 0; i < horizonDays; i += 1) dayDemand.set(addDays(today, i), 0);

  const ordered = [...items].sort((a, b) => (a.ob.due < b.ob.due ? -1 : a.ob.due > b.ob.due ? 1 : 0));
  for (const item of ordered) {
    let need = item.unit;
    if (item.late) {
      item.feasible = false;
      item.shortfall = need;
      item.pressure = 1;
      dayDemand.set(today, (dayDemand.get(today) || 0) + need);
      continue;
    }
    for (let d = item.ob.due; d >= today && need > 0; d = addDays(d, -1)) {
      const free = remaining.get(d) || 0;
      const take = Math.min(free, need);
      remaining.set(d, free - take);
      need -= take;
    }
    item.shortfall = Math.round(need);
    item.feasible = need <= 0;
    // Pressure: how much of a day this deadline claims on average until it is due.
    // It is what the timeline shows; feasibility above is the schedule, not an average.
    for (let i = 0; i < item.availableDays; i += 1) {
      const d = addDays(today, i);
      if (d > item.ob.due) break;
      dayDemand.set(d, (dayDemand.get(d) || 0) + item.unit / item.availableDays);
    }
  }

  const days = [];
  for (let i = 0; i < horizonDays; i += 1) {
    const d = addDays(today, i);
    const demand = Math.round(dayDemand.get(d) || 0);
    days.push({ date: d, demand, capacity, ratio: capacity ? demand / capacity : 0 });
  }

  const workRemaining = items.reduce((sum, i) => sum + i.unit, 0);
  const capacityAvailable = capacity * horizonDays;
  const infeasible = items.filter((i) => !i.feasible);
  const leverage = [...artifactPlan.values()]
    .filter((p) => p.minutes > 0 && new Set(p.sharers).size >= 2)
    .sort((a, b) => new Set(b.sharers).size - new Set(a.sharers).size || b.minutes - a.minutes);

  return {
    today,
    horizonEnd,
    horizonDays,
    capacity,
    days,
    items,
    ordered,
    artifactPlan,
    leverage,
    stats: {
      openInHorizon: items.length,
      workRemaining,
      capacityAvailable,
      infeasible: infeasible.length,
      shortfall: infeasible.reduce((s, i) => s + i.shortfall, 0),
      sharedArtifacts: leverage.length,
      overDays: days.filter((d) => d.demand > d.capacity).length,
    },
  };
}

/** Plain-language verdict for one deadline. */
export function verdictOf(item) {
  if (item.late) return { label: "overdue", cls: "over" };
  if (!item.feasible) return { label: `short ${fmtMinutes(item.shortfall)}`, cls: "over" };
  if (item.unit === 0) return { label: "nothing left", cls: "ok" };
  if (item.daysLeft <= 2) return { label: "start now", cls: "warn" };
  return { label: "fits", cls: "ok" };
}

export function fmtMinutes(minutes) {
  const value = Math.max(0, Math.round(minutes));
  if (value < 60) return `${value}m`;
  const h = Math.floor(value / 60);
  const m = value % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
