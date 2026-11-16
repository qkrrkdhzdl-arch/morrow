// Bipartite graph view: deadlines on the left, artifacts on the right.
// No layout library and no force simulation: the ordering carries meaning
// (deadlines by date, artifacts by how much work is left), so a deterministic
// layout says more than an aesthetic one.

const NS = "http://www.w3.org/2000/svg";

const STATUS_COLOR = {
  ready: "#14654c",
  draft: "#9a5b12",
  missing: "#a63a25",
};

const CHANNEL_COLOR = {
  contest: "#1d4ed8",
  grant: "#6d28d9",
  campaign: "#9a5b12",
  admin: "#455a64",
  client: "#166534",
  content: "#9d174d",
  investor: "#0f766e",
  launch: "#a16207",
  talk: "#4338ca",
};

function el(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function truncate(text, n) {
  const s = String(text || "");
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export function renderGraph(svg, model, handlers = {}) {
  const width = 960;
  const height = 520;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const padTop = 26;
  const padBottom = 18;
  const leftX = 214;
  const rightX = width - 250;

  const obs = [...model.obligations].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  const arts = [...model.artifacts].sort((a, b) => {
    const rank = { missing: 0, draft: 1, ready: 2 };
    const d = (rank[a.status] ?? 3) - (rank[b.status] ?? 3);
    if (d !== 0) return d;
    return (b.minutes_left || 0) - (a.minutes_left || 0);
  });

  const rowH = (height - padTop - padBottom) / Math.max(obs.length, arts.length, 1);
  const pos = new Map();
  obs.forEach((o, i) => {
    pos.set(o.id, { x: leftX, y: padTop + rowH * (i + 0.5), r: 4 + Math.sqrt(Number(o.minutes) || 0) / 2.4, node: o, kind: "obligation" });
  });
  arts.forEach((a, i) => {
    pos.set(a.id, { x: rightX, y: padTop + rowH * (i + 0.5), r: 3.5 + Math.sqrt(Number(a.minutes_left) || 0) / 2.6, node: a, kind: "artifact" });
  });

  const gEdges = el("g");
  const gDeps = el("g");
  const gNodes = el("g");
  svg.append(gDeps, gEdges, gNodes);

  const edgeEls = [];
  for (const n of model.needs) {
    const from = pos.get(n.obligation);
    const to = pos.get(n.artifact);
    if (!from || !to) continue;
    const midX = (from.x + to.x) / 2;
    const path = el("path", {
      class: "edge",
      d: `M ${from.x + from.r} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x - to.r} ${to.y}`,
    });
    path.dataset.from = n.obligation;
    path.dataset.to = n.artifact;
    gEdges.append(path);
    edgeEls.push(path);
  }

  for (const d of model.depends) {
    const a = pos.get(d.artifact);
    const b = pos.get(d.on);
    if (!a || !b) continue;
    const bow = 30;
    const path = el("path", {
      class: "edge dep",
      d: `M ${a.x + a.r} ${a.y} C ${a.x + bow} ${a.y - 18}, ${b.x + bow} ${b.y + 18}, ${b.x + b.r} ${b.y}`,
    });
    path.dataset.from = d.artifact;
    path.dataset.to = d.on;
    gDeps.append(path);
    edgeEls.push(path);
  }

  const nodeEls = [];
  for (const [id, p] of pos) {
    const isOb = p.kind === "obligation";
    const color = isOb ? CHANNEL_COLOR[p.node.channel] || "#414a4e" : STATUS_COLOR[p.node.status] || "#414a4e";
    const g = el("g", { class: "node", tabindex: "0", role: "button" });
    g.dataset.id = id;
    g.dataset.kind = p.kind;
    const circle = el("circle", { cx: p.x, cy: p.y, r: p.r, fill: color, "fill-opacity": isOb ? 0.92 : 0.85, stroke: "#fffefb", "stroke-width": 1.2 });
    g.append(circle);
    const label = el("text", {
      x: isOb ? p.x - p.r - 8 : p.x + p.r + 8,
      y: p.y + 3.5,
      "text-anchor": isOb ? "end" : "start",
    });
    label.textContent = truncate(isOb ? p.node.title : p.node.title, isOb ? 34 : 30);
    g.append(label);
    g.addEventListener("click", () => handlers.onSelect && handlers.onSelect(p.kind, id));
    g.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") handlers.onSelect && handlers.onSelect(p.kind, id);
    });
    gNodes.append(g);
    nodeEls.push(g);
  }

  // Column headers
  const headL = el("text", { x: leftX, y: 14, "text-anchor": "middle", "font-size": 10, fill: "#6d777b", "letter-spacing": "0.08em" });
  headL.textContent = "DEADLINES";
  const headR = el("text", { x: rightX, y: 14, "text-anchor": "middle", "font-size": 10, fill: "#6d777b", "letter-spacing": "0.08em" });
  headR.textContent = "ARTIFACTS";
  svg.append(headL, headR);

  return {
    focus(id) {
      const keep = new Set([id]);
      for (const e of edgeEls) {
        if (e.dataset.from === id) keep.add(e.dataset.to);
        if (e.dataset.to === id) keep.add(e.dataset.from);
      }
      for (const n of nodeEls) n.classList.toggle("dim", !keep.has(n.dataset.id));
      for (const e of edgeEls) {
        const hot = e.dataset.from === id || e.dataset.to === id;
        e.classList.toggle("hot", hot);
        e.classList.toggle("dim", !hot);
      }
    },
    clear() {
      for (const n of nodeEls) n.classList.remove("dim");
      for (const e of edgeEls) {
        e.classList.remove("hot");
        e.classList.remove("dim");
      }
    },
  };
}
