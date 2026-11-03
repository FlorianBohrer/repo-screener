/* ============ State ============ */
let DATA = null, A = null, MODE = "heur", DIR = "TD", DIR_MODE = "auto", AI = null, SELECTED = null, TAB = "arch";
/* Optional extensions (e.g. a second diagram mode) register here */
const EXT = { onShow: [], onLayout: [] };
const REDUCE = matchMedia("(prefers-reduced-motion: reduce)");
const currentAst = () => (MODE === "ai" && AI ? AI.ast : heuristicAst(A));

/* ============ Springs (critically damped by default, interruptible, velocity is preserved) ============ */
function spring(value, { response = 0.38, damping = 1, eps = 0.2 } = {}) {
  const s = { value, target: value, vel: 0, response, damping, eps, raf: 0, onUpdate: null, onRest: null };
  const step = (() => { let last = 0; return now => {
    if (!last) last = now;
    const dt = Math.min(0.032, (now - last) / 1000); last = now;
    const w = 2 * Math.PI / s.response;
    s.vel += (-w * w * (s.value - s.target) - 2 * s.damping * w * s.vel) * dt;
    s.value += s.vel * dt;
    if (Math.abs(s.value - s.target) < s.eps && Math.abs(s.vel) < s.eps * 8) {
      s.value = s.target; s.vel = 0; s.raf = 0; last = 0; s.onUpdate?.(s.value); s.onRest?.(); return;
    }
    s.onUpdate?.(s.value); s.raf = requestAnimationFrame(step);
  }; })();
  s.to = (t, o = {}) => {
    s.target = t; if (o.velocity != null) s.vel = o.velocity;
    if (o.response) s.response = o.response; if (o.damping != null) s.damping = o.damping;
    if (REDUCE.matches) { s.set(t); s.onRest?.(); return; }
    if (!s.raf) s.raf = requestAnimationFrame(step);
  };
  s.set = v => { cancelAnimationFrame(s.raf); s.raf = 0; s.value = s.target = v; s.vel = 0; s.onUpdate?.(v); };
  s.stop = () => { cancelAnimationFrame(s.raf); s.raf = 0; s.target = s.value; };
  return s;
}
const project = (v, d = 0.996) => (v / 1000) * d / (1 - d); /* Apple's momentum projection */
const rubber = (o, dim, c = 0.55) => (o * dim * c) / (dim + c * Math.abs(o));

/* ============ Header: repo, tabs with a spring indicator ============ */
function repoUrl(path, isDir) {
  if (!DATA || DATA.source === "local") return null;
  const [o, r] = DATA.repo.split("/");
  return `https://github.com/${o}/${r}/${isDir ? "tree" : "blob"}/${encodeURIComponent(DATA.branch)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
function firstSentence(md) {
  if (!md) return "";
  const lines = md.split("\n").map(s => s.trim()).filter(s => s && !/^(#|!|\[!|<|>|\||```|-{3})/.test(s));
  const t = (lines[0] || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`]/g, "");
  return t.length > 200 ? t.slice(0, 197) + "…" : t;
}
const tabX = spring(0, { eps: 0.3 }), tabW = spring(0, { eps: 0.3 });
tabX.onUpdate = tabW.onUpdate = () => { const i = $("#tabInd"); i.style.transform = `translateX(${tabX.value}px)`; i.style.width = tabW.value + "px"; };
function moveTabInd(animate = true) {
  const b = document.querySelector(`.tab[data-tab="${TAB}"]`); if (!b) return;
  const x = b.offsetLeft + 8, w = b.offsetWidth - 16;
  if (animate && tabW.value) { tabX.to(x); tabW.to(w); } else { tabX.set(x); tabW.set(w); }
}
/* Segmented control with a spring background */
function segKnob(seg) {
  const knob = seg.querySelector(".knob"), sx = spring(0, { eps: 0.3, response: 0.32 }), sw = spring(0, { eps: 0.3, response: 0.32 });
  sx.onUpdate = sw.onUpdate = () => { knob.style.transform = `translateX(${sx.value}px)`; knob.style.width = sw.value + "px"; };
  return (animate = true) => { const b = seg.querySelector('button[aria-pressed="true"]'); if (!b) return;
    if (animate && sw.value) { sx.to(b.offsetLeft); sw.to(b.offsetWidth); } else { sx.set(b.offsetLeft); sw.set(b.offsetWidth); } };
}
const knobDir = segKnob($("#segDir"));
let knobMode = () => {};

function renderHeader() {
  const src = DATA.source === "sample" ? "Example · public GitHub repository" : DATA.source === "local" ? "Local folder" : "GitHub";
  $("#repoName").textContent = DATA.repo;
  $("#envTxt").textContent = DATA.branch || "lokal";
  $("#srcLabel").textContent = src;
  const h = $("#repoTitle"); h.textContent = "";
  h.append(DATA.source === "local" ? DATA.repo : el("a", { href: "https://github.com/" + DATA.repo, target: "_blank", rel: "noopener" }, DATA.repo));
  if (DATA.source === "sample") h.append(el("span", { class: "tag-example" }, "Example"));
  $("#repoDesc").textContent = DATA.description || firstSentence(DATA.readme) || "";
  const k = $("#kpis"); k.textContent = "";
  const kpi = (v, l, cls) => el("div", { class: "kpi " + (cls || "") }, el("b", {}, v), el("span", {}, l));
  k.append(kpi(fmtInt(A.files.length), "Files"), kpi(fmtInt(A.compCount), "Components"), kpi(fmtInt(A.resolved), "Imports", "opt"), kpi(fmtBytes(A.total), "Size", "opt"), kpi(A.score, "Score"));
  $("#bArch").textContent = A.compCount; $("#bFiles").textContent = fmtInt(A.files.length); $("#bScore").textContent = A.score;
}

/* ============ Canvas: layout, cards, edges ============ */
const CARD_W = 212, CARD_H = 60, CHIP_W = 184, CHIP_H = 34;
let SHOW_SIDE = false;
const USE_CLUSTERS = false; /* dagre clusters pull the flow apart; frames are only drawn when they are free of other cards */
/* Cards grow with their number of ports so lines do not crowd at the edge */
let PORT_DEG = new Map();
const PORT_GAP_TD = 22, PORT_GAP_LR = 15;
const dim = (n, td = DIR === "TD") => {
  if (n.kind === "user") return { w: 118, h: 40 };
  if (n._chip) return { w: CHIP_W, h: CHIP_H };
  const k = PORT_DEG.get(n.id) || 0;
  return td ? { w: Math.max(CARD_W, Math.round(k * PORT_GAP_TD / 0.75)), h: CARD_H } : { w: CARD_W, h: Math.max(CARD_H, Math.round(k * PORT_GAP_LR / 0.75)) };
};
/* The gap between ranks grows with the number of lines crossing it */
const rankSep = (edges, td) => { const maxDeg = Math.max(0, ...PORT_DEG.values()); return (td ? 46 : 64) + Math.min(td ? 70 : 110, Math.max(0, edges.length - 10) * (td ? 2.2 : 3.2) + maxDeg * 4); };
const view = { s: spring(1, { eps: 0.0005 }), x: spring(0, { eps: 0.2 }), y: spring(0, { eps: 0.2 }) };
let viewRaf = 0;
const applyView = () => { if (viewRaf) return; viewRaf = requestAnimationFrame(() => { viewRaf = 0; const c = $("#canvas"); c.style.transform = `translate(${view.x.value}px,${view.y.value}px) scale(${view.s.value})`; c.classList.toggle("far", view.s.value < 0.62); }); };
view.s.onUpdate = view.x.onUpdate = view.y.onUpdate = applyView;
let graphSize = { w: 0, h: 0 };

function renderLegend(ast) {
  const lg = $("#legend"); lg.textContent = "";
  const used = new Set(ast.nodes.filter(n => !n._chip).map(n => n.cat));
  for (const c of CAT_ORDER) if (used.has(c)) {
    const chip = el("span", { style: `--c:var(--c-${c})` }, el("i"), CATS[c].label);
    chip.addEventListener("mouseenter", () => { if (SELECTED || LOCK) return; $("#canvas").classList.add("preview"); CARD_ELS.forEach((card, id) => card.classList.toggle("dim", card.style.getPropertyValue("--c") !== `var(--c-${c})`)); EDGE_ELS.forEach(x => { x.base.classList.add("dim"); x.label?.classList.add("dim"); }); GROUP_ELS.forEach(g => g.el.classList.add("dim")); });
    chip.addEventListener("mouseleave", () => { if (!SELECTED && !LOCK) highlight(null); });
    lg.append(chip);
  }
}
function catIcon(cat) { return svgUse("k-" + cat); }

/* Automatic direction: compute both layouts and use the one that fits this screen larger (more readable) */
function pickDir(linked, edges) {
  if (!linked.length || typeof dagre === "undefined") return "TD";
  const st = $("#stage"), sw = st.clientWidth || 1200, sh = st.clientHeight || 700;
  const size = td => {
    const g = new dagre.graphlib.Graph(); g.setGraph({ rankdir: td ? "TB" : "LR", nodesep: td ? 34 : 30, edgesep: 22, ranksep: rankSep(edges, td), marginx: 50, marginy: 50 }); g.setDefaultEdgeLabel(() => ({}));
    linked.forEach(n => { const d = dim(n, td); g.setNode(n.id, { width: d.w, height: d.h }); });
    edges.forEach(e => { if (g.hasNode(e.from) && g.hasNode(e.to)) g.setEdge(e.from, e.to, e.label ? { width: Math.ceil(e.label.length * 6.1 + 16), height: 18, labelpos: "c" } : {}); });
    dagre.layout(g); return { w: g.graph().width, h: g.graph().height };
  };
  const fit = ({ w, h }) => Math.min((sw - 60) / w, (sh - 150) / h);
  const td = size(true), lr = size(false);
  return fit(lr) > fit(td) * 1.12 ? "LR" : "TD";
}
function updateDirUi() {
  const auto = $("#dirAuto"); if (!auto) return;
  [["dirAuto", "auto"], ["dirTD", "TD"], ["dirLR", "LR"]].forEach(([id, m]) => $("#" + id).setAttribute("aria-pressed", DIR_MODE === m));
  auto.lastChild.textContent = DIR === "TD" ? "↓" : "→";
  auto.title = `Automatic: ${DIR === "TD" ? "top to bottom" : "left to right"}`;
  requestAnimationFrame(() => knobDir());
}

/* Orthogonal path with rounded corners through the waypoints */
function roundPath(v, r = 9) {
  const pts = v.filter((p, i) => i === 0 || Math.abs(p.x - v[i - 1].x) > 0.5 || Math.abs(p.y - v[i - 1].y) > 0.5);
  const q = pts.filter((p, i) => i === 0 || i === pts.length - 1 || !((Math.abs(pts[i - 1].x - p.x) < 0.5 && Math.abs(pts[i + 1].x - p.x) < 0.5) || (Math.abs(pts[i - 1].y - p.y) < 0.5 && Math.abs(pts[i + 1].y - p.y) < 0.5)));
  let d = `M${q[0].x.toFixed(1)},${q[0].y.toFixed(1)}`;
  for (let i = 1; i < q.length - 1; i++) {
    const a = q[i - 1], c = q[i], b = q[i + 1];
    const d1 = Math.hypot(c.x - a.x, c.y - a.y), d2 = Math.hypot(b.x - c.x, b.y - c.y), rr = Math.min(r, d1 / 2, d2 / 2);
    const p1 = { x: c.x - (c.x - a.x) / d1 * rr, y: c.y - (c.y - a.y) / d1 * rr }, p2 = { x: c.x + (b.x - c.x) / d2 * rr, y: c.y + (b.y - c.y) / d2 * rr };
    d += ` L${p1.x.toFixed(1)},${p1.y.toFixed(1)} Q${c.x.toFixed(1)},${c.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  const z = q[q.length - 1]; return d + ` L${z.x.toFixed(1)},${z.y.toFixed(1)}`;
}

function renderCanvas({ animate = true } = {}) {
  if (!A) return;
  const base = currentAst();
  /* Tooling, tests, docs and developer infrastructure are hidden by default (as usual in architecture diagrams) */
  const hideSide = MODE === "heur" && !SHOW_SIDE;
  const hidden = new Set(hideSide ? base.nodes.filter(n => n.side).map(n => n.id) : []);
  const ast = { nodes: base.nodes.map(n => ({ ...n })), edges: base.edges.filter(e => !hidden.has(e.from) && !hidden.has(e.to)) };
  const sideBtn = $("#sideBtn");
  if (sideBtn) { const cnt = base.nodes.filter(n => n.side).length; sideBtn.hidden = MODE !== "heur" || !cnt; sideBtn.setAttribute("aria-pressed", SHOW_SIDE); sideBtn.lastChild.textContent = `Tooling & Tests (${cnt})`; }
  const ov = $("#overview");
  if (MODE === "ai" && AI) { ov.hidden = false; ov.textContent = ""; ov.append(el("div", { class: "who" }, AI.who || "Overview"), el("p", {}, AI.overview || "")); }
  else if (A.analysed === 0) { ov.hidden = false; ov.textContent = ""; ov.append(el("p", { class: "muted" }, "No source code was read for this repository, so the diagram only shows the folder structure without connections.")); }
  else ov.hidden = true;
  const nodesEl = $("#nodes"), svg = $("#edges"), empty = $("#stageEmpty");
  nodesEl.textContent = ""; svg.textContent = "";
  if (typeof dagre === "undefined") { empty.hidden = false; empty.textContent = "The layout library could not be loaded. Check your connection and reload the page."; return; }
  empty.hidden = true;

  const linkedIds = new Set(ast.edges.flatMap(e => [e.from, e.to]));
  const linked = ast.nodes.filter(n => linkedIds.has(n.id)), loose = ast.nodes.filter(n => !linkedIds.has(n.id));
  loose.forEach(n => { n._chip = true; });
  renderLegend(ast);
  const byId = new Map(ast.nodes.map(n => [n.id, n]));
  const extIds = new Set(linked.filter(n => n.kind === "ext" || (MODE === "ai" && !n.path && n.kind !== "user")).map(n => n.id));
  PORT_DEG = new Map();
  for (const n of linked) { const o = ast.edges.filter(e => e.from === n.id).length, i = ast.edges.filter(e => e.to === n.id).length; PORT_DEG.set(n.id, Math.max(o, i)); }
  if (DIR_MODE === "auto") DIR = pickDir(linked, ast.edges);
  const TD = DIR === "TD";
  updateDirUi();

  /* Feature-area groups (≥ 2 components) are laid out as clusters; layer groups are not */
  const groupOf = n => n.group || CATS[n.cat].label;
  const semantic = n => n.kind === "comp" && !extIds.has(n.id) && (MODE === "ai" || (n.group && n.group !== CATS[n.cat].label));
  const groups = new Map();
  for (const n of linked) if (semantic(n) || (MODE === "ai" && n.kind !== "user" && !extIds.has(n.id))) { const gl = groupOf(n); if (!groups.has(gl)) groups.set(gl, { id: "grp" + groups.size, label: gl, members: [] }); groups.get(gl).members.push(n.id); }
  for (const [k, gr] of [...groups]) if (gr.members.length < 2) groups.delete(k);
  const groupIdOf = new Map(); groups.forEach(gr => gr.members.forEach(m => groupIdOf.set(m, gr.id)));

  const layout = extraMinlen => {
    const g = new dagre.graphlib.Graph({ compound: true });
    g.setGraph({ rankdir: TD ? "TB" : "LR", nodesep: TD ? 34 : 30, edgesep: 22, ranksep: rankSep(ast.edges, TD), marginx: 50, marginy: 50 });
    g.setDefaultEdgeLabel(() => ({}));
    if (USE_CLUSTERS) groups.forEach(gr => g.setNode(gr.id, {}));
    for (const n of linked) { if (!extraMinlen && extIds.has(n.id)) continue; const d = dim(n); g.setNode(n.id, { width: d.w, height: d.h }); if (USE_CLUSTERS && groupIdOf.has(n.id)) g.setParent(n.id, groupIdOf.get(n.id)); }
    for (const e of ast.edges) {
      if (!extraMinlen && (extIds.has(e.from) || extIds.has(e.to))) continue;
      const lab = e.label ? { width: Math.ceil(e.label.length * 6.1 + 16), height: 18, labelpos: "c", label: e.label } : {};
      g.setEdge(e.from, e.to, { ...lab, minlen: extraMinlen && extIds.has(e.to) ? extraMinlen(e.from) : 1 });
    }
    dagre.layout(g);
    return g;
  };
  let g;
  try {
    if (extIds.size) {
      /* Pass 1 without services finds the ranks; pass 2 pushes all services into the last rank */
      const g0 = layout(null), key = id => Math.round(TD ? g0.node(id).y : g0.node(id).x);
      const levels = [...new Set(linked.filter(n => !extIds.has(n.id)).map(n => key(n.id)))].sort((a, b) => a - b);
      const levelOf = id => g0.hasNode(id) ? levels.indexOf(key(id)) : 0;
      g = layout(from => levels.length - levelOf(from));
    } else g = layout(null);
  } catch (err) { console.error(err); empty.hidden = false; empty.textContent = "The layout could not be computed."; return; }
  let W = linked.length ? Math.ceil(g.graph().width) : 0, H = linked.length ? Math.ceil(g.graph().height) : 0;
  const pos = new Map(linked.map(n => [n.id, g.node(n.id)]));

  /* Components without connections: compact chips in rows below */
  let looseRect = null;
  if (loose.length) {
    const cols = Math.max(2, Math.min(7, Math.floor(((W || 900) - 100) / (CHIP_W + 12))));
    const sorted = [...loose].sort((a, b) => (a.side - b.side) || CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b.cat));
    const y0 = (H ? H + 10 : 60) + 30 + CHIP_H / 2, x0 = 50 + CHIP_W / 2;
    sorted.forEach((n, i) => pos.set(n.id, { x: x0 + (i % cols) * (CHIP_W + 12), y: y0 + Math.floor(i / cols) * (CHIP_H + 10) }));
    const rows = Math.ceil(sorted.length / cols);
    looseRect = { x0: 34, y0: y0 - CHIP_H / 2 - 30, x1: 50 + Math.min(cols, sorted.length) * (CHIP_W + 12) + 4, y1: y0 + (rows - 1) * (CHIP_H + 10) + CHIP_H / 2 + 14 };
    W = Math.max(W, looseRect.x1 + 50); H = looseRect.y1 + 50;
  }
  graphSize = { w: W, h: H };
  svg.setAttribute("width", W); svg.setAttribute("height", H); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  /* Frames: feature areas and the area holding the remaining components */
  const frames = [];
  groups.forEach(gr => {
    const bs = gr.members.map(id => { const p = pos.get(id), d = dim(byId.get(id)); return { x0: p.x - d.w / 2, x1: p.x + d.w / 2, y0: p.y - d.h / 2, y1: p.y + d.h / 2 }; });
    const r = { x0: Math.min(...bs.map(b => b.x0)) - 14, x1: Math.max(...bs.map(b => b.x1)) + 14, y0: Math.min(...bs.map(b => b.y0)) - 30, y1: Math.max(...bs.map(b => b.y1)) + 12 };
    const foreign = linked.some(n => !gr.members.includes(n.id) && (() => { const p = pos.get(n.id), d = dim(n); return p.x + d.w / 2 > r.x0 && p.x - d.w / 2 < r.x1 && p.y + d.h / 2 > r.y0 && p.y - d.h / 2 < r.y1; })());
    if (foreign) return;
    gr.el = el("div", { class: "grp", style: `left:${r.x0}px;top:${r.y0}px;width:${r.x1 - r.x0}px;height:${r.y1 - r.y0}px` }, el("span", {}, gr.label));
    frames.push(gr); nodesEl.append(gr.el);
  });
  if (looseRect) {
    const lab = hideSide && hidden.size ? `More components · tooling, tests, docs and unconnected` : linked.length ? "No import connections" : "Components";
    const fr = { id: "grpLoose", label: lab, members: loose.map(n => n.id) };
    fr.el = el("div", { class: "grp loose", style: `left:${looseRect.x0}px;top:${looseRect.y0}px;width:${looseRect.x1 - looseRect.x0}px;height:${looseRect.y1 - looseRect.y0}px` }, el("span", {}, lab));
    frames.push(fr); nodesEl.append(fr.el);
  }

  /* Edges: orthogonal with rounded corners; every edge gets its own port on the card edge */
  const NS = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(NS, "defs");
  for (const [id, col] of [["arr", "var(--edge)"], ["arrHot", "var(--edge-hot)"]]) {
    const m = document.createElementNS(NS, "marker");
    Object.entries({ id, viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "8", markerHeight: "8", markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" }).forEach(([k, v]) => m.setAttribute(k, v));
    /* drafting-style arrowhead: a narrow filled triangle */
    const p = document.createElementNS(NS, "path"); p.setAttribute("d", "M0 1.6L9.5 5 0 8.4z"); p.setAttribute("fill", col); p.setAttribute("stroke", "none");
    m.append(p); defs.append(m);
  }
  svg.append(defs);
  const P = TD ? "y" : "x", S = TD ? "x" : "y"; /* main axis (flow) and cross axis */
  const routes = ast.edges.map((e, i) => ({ e, i, ed: g.hasEdge(e.from, e.to) ? g.edge(e.from, e.to) : null })).filter(r => r.ed && pos.has(r.e.from) && pos.has(r.e.to));
  /* Distribute ports, sorted by the direction the edge heads to */
  const ports = new Map();
  const assign = (id, list, side) => {
    const n = byId.get(id), d = dim(n), c = pos.get(id)[S], span = (TD ? d.w : d.h) * (n.kind === "user" ? 0.4 : 0.78);
    list.sort((a, b) => a.k - b.k);
    const step = list.length > 1 ? Math.min(TD ? 26 : 18, span / (list.length - 1)) : 0;
    list.forEach((r, j) => ports.set(r.r.i + side, c + (j - (list.length - 1) / 2) * step));
  };
  const outs = new Map(), ins = new Map();
  routes.forEach(r => {
    const pts = r.ed.points;
    const nextS = pts.length > 2 ? pts[1][S] : pos.get(r.e.to)[S], prevS = pts.length > 2 ? pts[pts.length - 2][S] : pos.get(r.e.from)[S];
    if (!outs.has(r.e.from)) outs.set(r.e.from, []); outs.get(r.e.from).push({ r, k: nextS });
    if (!ins.has(r.e.to)) ins.set(r.e.to, []); ins.get(r.e.to).push({ r, k: prevS });
  });
  outs.forEach((l, id) => assign(id, l, ":o")); ins.forEach((l, id) => assign(id, l, ":i"));
  const maxW = Math.max(1, ...ast.edges.map(e => e.w || 1));
  EDGE_ELS = [];
  /* 1. Build waypoints; remember cross segments so they can get their own lanes afterwards */
  const cross = [];
  const built = routes.map(({ e, i, ed }) => {
    const a = pos.get(e.from), b = pos.get(e.to), da = dim(byId.get(e.from)), db = dim(byId.get(e.to));
    const start = { [S]: ports.get(i + ":o"), [P]: a[P] + (TD ? da.h : da.w) / 2 };
    const end = { [S]: ports.get(i + ":i"), [P]: b[P] - (TD ? db.h : db.w) / 2 - 2 };
    const seq = [start, ...ed.points.slice(1, -1), end];
    const v = [start];
    for (let k = 0; k < seq.length - 1; k++) {
      const p = v[v.length - 1], q = seq[k + 1];
      if (Math.abs(p[S] - q[S]) < 2) { v.push({ [S]: p[S], [P]: q[P] }); continue; }
      const m1 = { [S]: p[S], [P]: (p[P] + q[P]) / 2 }, m2 = { [S]: q[S], [P]: (p[P] + q[P]) / 2 };
      v.push(m1, m2, { [S]: q[S], [P]: q[P] });
      cross.push({ m1, m2, lo: p[P], hi: q[P], key: Math.round((p[P] + q[P]) / 2 / 6), from: Math.min(p[S], q[S]), to: Math.max(p[S], q[S]) });
    }
    return { e, ed, v };
  });
  /* 2. Lanes: overlapping cross segments in the same gap get different offsets */
  /* Cross segments in the same gap (centers < 28 px apart) form a channel and are spread out together */
  cross.forEach(c => { c.mid = c.m1[P]; });
  const sortedCross = [...cross].sort((x, y) => x.mid - y.mid), channels = [];
  for (const c of sortedCross) { const ch = channels[channels.length - 1]; if (ch && c.mid - ch.last < 28) { ch.items.push(c); ch.last = c.mid; } else channels.push({ items: [c], last: c.mid }); }
  for (const ch of channels) {
    const list = ch.items.sort((x, y) => x.from - y.from || x.to - y.to);
    const lanes = []; list.forEach(c => { let l = lanes.findIndex(end => end < c.from - 10); if (l < 0) { l = lanes.length; lanes.push(c.to); } else lanes[l] = c.to; c.lane = l; });
    const n = lanes.length, center = list.reduce((a, c) => a + c.mid, 0) / list.length;
    const lo = Math.max(...list.map(c => Math.min(c.lo, c.hi))) + 12, hi = Math.min(...list.map(c => Math.max(c.lo, c.hi))) - 12;
    const room = Math.max(8, hi - lo), step = n > 1 ? Math.min(22, room / (n + 1)) : 0;
    const base = Math.min(Math.max(center - (n - 1) * step / 2, lo), Math.max(lo, hi - (n - 1) * step));
    list.forEach(c => { const pos = n > 1 ? base + c.lane * step : center; c.m1[P] = pos; c.m2[P] = pos; });
  }
  built.forEach(({ e, ed, v }, ri) => {
    const d = roundPath(v);
    const sw = e.w ? 1.1 + Math.min(1.3, Math.log2(e.w + 1) * 0.3) : 1.15;
    const basePath = document.createElementNS(NS, "path"); basePath.setAttribute("d", d); basePath.setAttribute("class", "edge" + (extIds.has(e.to) || e.from === "u_user" ? " soft" : "")); basePath.setAttribute("stroke-width", sw); basePath.setAttribute("marker-end", "url(#arr)");
    const flow = document.createElementNS(NS, "path"); flow.setAttribute("d", d); flow.setAttribute("class", "flow"); flow.setAttribute("stroke-width", Math.max(1.4, sw));
    if (e.w) flow.style.animationDuration = (1.6 - Math.min(0.9, (e.w / maxW) * 0.9)).toFixed(2) + "s";
    const hit = document.createElementNS(NS, "path"); hit.setAttribute("d", d); hit.setAttribute("class", "hit"); hit.dataset.from = e.from;
    const tipText = `${byId.get(e.from)?.label} → ${byId.get(e.to)?.label}\n${e.label || ""}${e.w ? ` · ${e.w} import${e.w === 1 ? "" : "s"}` : ""}`;
    hit.addEventListener("mouseenter", () => { basePath.classList.add("hover"); if (!SELECTED && !LOCK) { label?.classList.add("hot"); } });
    hit.addEventListener("mousemove", ev => { const t = $("#tip"); t.hidden = false; t.textContent = tipText; t.style.left = Math.min(ev.clientX + 14, innerWidth - 370) + "px"; t.style.top = (ev.clientY + 16) + "px"; });
    hit.addEventListener("mouseleave", () => { basePath.classList.remove("hover"); $("#tip").hidden = true; if (!SELECTED && !LOCK) label?.classList.remove("hot"); });
    svg.append(basePath, flow, hit);
    var label = null;
    if (e.label) {
      /* Label on the longest segment along the flow */
      let best = null; for (let k = 0; k < v.length - 1; k++) { const L = Math.abs(v[k + 1][P] - v[k][P]); if (Math.abs(v[k + 1][S] - v[k][S]) < 1 && (!best || L > best.L)) best = { L, x: (v[k].x + v[k + 1].x) / 2, y: (v[k].y + v[k + 1].y) / 2 }; }
      const lp = best || { x: ed.x, y: ed.y };
      label = el("div", { class: "elabel", style: `left:${lp.x}px;top:${lp.y}px`, title: e.w ? `${e.w} import${e.w === 1 ? "" : "s"}` : "" }, e.label); nodesEl.append(label);
    }
    EDGE_ELS.push({ e, base: basePath, flow, label });
    if (animate && !REDUCE.matches) {
      const len = basePath.getTotalLength();
      basePath.animate([{ strokeDasharray: `${len} ${len}`, strokeDashoffset: len }, { strokeDasharray: `${len} ${len}`, strokeDashoffset: 0 }], { duration: 650, delay: 240 + ri * 12, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" });
      label?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 600 + ri * 12, fill: "backwards" });
    }
  });

  /* Cards – fade in staggered by rank */
  CARD_ELS = new Map();
  const order = [...ast.nodes].sort((a, b) => pos.get(a.id)[P] - pos.get(b.id)[P] || pos.get(a.id)[S] - pos.get(b.id)[S]);
  order.forEach((n, i) => {
    const p = pos.get(n.id), d = dim(n);
    const isExt = n.kind === "ext" || (MODE === "ai" && !n.path && n.kind !== "user");
    const at = `left:${p.x - d.w / 2}px;top:${p.y - d.h / 2}px` + (!n._chip && n.kind !== "user" && (d.w !== CARD_W || d.h !== CARD_H) ? `;width:${d.w}px;height:${d.h}px` : "");
    let card;
    if (n.kind === "user") {
      card = el("div", { class: "card user", style: `--c:var(--c-user);${at}` }, el("span", { class: "ico" }, catIcon("user")), el("span", { class: "nm" }, n.label));
    } else if (n._chip) {
      card = el("div", { class: "card chip", style: `--c:var(--c-${n.cat});${at}`, title: n.path || n.label }, el("span", { class: "ico" }, catIcon(n.cat)), el("span", { class: "nm" }, n.label), MODE === "heur" && n.count ? el("span", { class: "cnt" }, fmtInt(n.count)) : null);
    } else {
      const sub = MODE === "ai" ? (n.path ? basename(n.path) || n.path : "external service") : isExt ? `${n.main || "Service"} · external` : (n.main || n.path || "/");
      const cnt = MODE === "heur" && !isExt && !n.file ? n.count : MODE === "ai" && n.path ? A.files.filter(f => f.path === n.path || f.path.startsWith(n.path + "/")).length : 0;
      card = el("div", { class: "card" + (isExt ? " ext" : "") + (n.file ? " file" : ""), style: `--c:var(--c-${n.cat});${at}`, title: n.file && n.parentLabel ? `File in ${n.parentLabel}` : "" },
        el("span", { class: "ico" }, n.file ? svgUse("i-file") : catIcon(n.cat)),
        el("div", { class: "tx" }, el("div", { class: "nm" }, n.label), el("div", { class: "pth", title: n.path || "" }, sub)),
        cnt ? el("span", { class: "cnt", title: `${cnt} files` }, fmtInt(cnt)) : null);
    }
    Object.entries({ tabindex: "0", role: "button", "aria-label": n.label, "data-id": n.id }).forEach(([k, v]) => card.setAttribute(k, v));
    card.addEventListener("click", ev => { ev.stopPropagation(); select(n.id); centerOn(n.id); });
    card.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(n.id); } });
    card.addEventListener("pointerdown", ev => ev.stopPropagation());
    card.addEventListener("mouseenter", () => { if (!SELECTED && !LOCK) highlight(n.id, true); });
    card.addEventListener("mouseleave", () => { if (!SELECTED && !LOCK) highlight(null); });
    nodesEl.append(card); CARD_ELS.set(n.id, card);
    if (animate && !REDUCE.matches) card.animate([{ opacity: 0, transform: "translateY(8px) scale(.97)" }, { opacity: 1, transform: "none" }], { duration: 480, delay: Math.min(480, i * 24), easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" });
  });
  GROUP_ELS = frames;
  if (animate && !REDUCE.matches) GROUP_ELS.forEach((gr, i) => gr.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: i * 40, fill: "backwards" }));

  fitView(false);
  if (SELECTED && CARD_ELS.has(SELECTED)) highlight(SELECTED); else if (SELECTED) select(null);
}
let EDGE_ELS = [], CARD_ELS = new Map(), GROUP_ELS = [];
const heurNode = id => A.nodes.find(n => n.id === id);

function highlight(id, preview = false) {
  $("#canvas").classList.toggle("preview", !!id && preview);
  const ast = currentAst();
  const nb = new Set(id ? [id] : []);
  if (id) ast.edges.forEach(e => { if (e.from === id) nb.add(e.to); if (e.to === id) nb.add(e.from); });
  CARD_ELS.forEach((c, cid) => { c.classList.toggle("sel", cid === id); c.classList.toggle("dim", !!id && !nb.has(cid)); });
  GROUP_ELS.forEach(gr => gr.el.classList.toggle("dim", !!id && !gr.members.some(m => nb.has(m))));
  EDGE_ELS.forEach(({ e, base, flow, label }) => {
    const hot = !!id && (e.from === id || e.to === id);
    for (const x of [base, flow]) { x.classList.toggle("hot", hot); x.classList.toggle("dim", !!id && !hot); }
    base.setAttribute("marker-end", hot ? "url(#arrHot)" : "url(#arr)");
    if (label) { label.classList.toggle("hot", hot); label.classList.toggle("dim", !!id && !hot); }
  });
}

/* ============ Pan & zoom – 1:1 drag, momentum, scroll pans, ⌘/Ctrl + scroll zooms ============ */
function fitTarget() {
  const st = $("#stage"); if (!graphSize.w) return null;
  const sw = st.clientWidth, sh = st.clientHeight, bottom = 64, minS = sw < 700 ? 0.42 : 0.45;
  const sum = $("#summary"), hud = $(".hud");
  const hudH = (hud?.offsetHeight || 0) + 24, sumW = (sum?.offsetWidth || 0) + 34;
  /* Option A: below the summary, full width · option B: right of the summary, full height */
  const sA = Math.min((sw - 40) / graphSize.w, (sh - hudH - bottom) / graphSize.h);
  const sB = sw > 900 ? Math.min((sw - sumW - 24) / graphSize.w, (sh - 70 - bottom) / graphSize.h) : 0;
  if (sB > sA * 1.08) {
    const s = Math.min(1.05, Math.max(minS, sB));
    return { s, x: sumW + Math.max(0, (sw - sumW - 24 - graphSize.w * s) / 2), y: 70 + Math.max(0, (sh - 70 - bottom - graphSize.h * s) / 2) };
  }
  const s = Math.min(1.05, Math.max(minS, sA));
  return { s, x: (sw - graphSize.w * s) / 2, y: hudH + Math.max(0, (sh - hudH - bottom - graphSize.h * s) / 2) };
}
function fitView(animated) {
  const t = fitTarget(); if (!t) return;
  if (animated) { view.s.to(t.s); view.x.to(t.x); view.y.to(t.y); } else { view.s.set(t.s); view.x.set(t.x); view.y.set(t.y); }
}
function zoomBy(f, cx, cy, animated = true) {
  const s0 = view.s.target, ns = Math.min(2.5, Math.max(0.12, s0 * f));
  const nx = cx - (cx - view.x.target) * (ns / s0), ny = cy - (cy - view.y.target) * (ns / s0);
  if (animated) { view.s.to(ns); view.x.to(nx); view.y.to(ny); } else { view.s.set(ns); view.x.set(nx); view.y.set(ny); }
}
(function setupPan() {
  const st = $("#stage"); let drag = null;
  st.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    view.x.stop(); view.y.stop(); view.s.stop(); /* catches the canvas mid-glide */
    drag = { target: e.target, x: e.clientX, y: e.clientY, vx: view.x.value, vy: view.y.value, moved: false, hist: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }] };
    st.setPointerCapture(e.pointerId);
  });
  st.addEventListener("pointermove", e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) { drag.moved = true; st.classList.add("dragging"); }
    view.x.set(drag.vx + dx); view.y.set(drag.vy + dy);
    drag.hist.push({ x: e.clientX, y: e.clientY, t: e.timeStamp }); if (drag.hist.length > 6) drag.hist.shift();
  });
  st.addEventListener("pointerup", e => {
    if (!drag) return; st.classList.remove("dragging");
    const d = drag; drag = null;
    if (!d.moved) {
      const hit = d.target?.closest?.(".hit");
      if (hit) { $("#tip").hidden = true; select(hit.dataset.from); centerOn(hit.dataset.from); return; }
      if (!d.target?.closest?.(".card")) select(null); return;
    }
    const a = d.hist[0], b = d.hist[d.hist.length - 1], dt = (b.t - a.t) / 1000;
    if (dt <= 0 || e.timeStamp - b.t > 90) return;
    const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
    if (Math.hypot(vx, vy) < 150) return;
    view.x.to(view.x.value + project(vx), { velocity: vx, response: 0.7 });
    view.y.to(view.y.value + project(vy), { velocity: vy, response: 0.7 });
  });
  st.addEventListener("pointercancel", () => { drag = null; st.classList.remove("dragging"); });
  st.addEventListener("wheel", e => {
    e.preventDefault();
    const r = st.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomBy(Math.exp(-e.deltaY * 0.006), e.clientX - r.left, e.clientY - r.top, false);
    else { view.x.set(view.x.value - e.deltaX); view.y.set(view.y.value - e.deltaY); }
  }, { passive: false });
  $("#zIn").onclick = () => zoomBy(1.3, st.clientWidth / 2, st.clientHeight / 2);
  $("#zOut").onclick = () => zoomBy(1 / 1.3, st.clientWidth / 2, st.clientHeight / 2);
  $("#zFit").onclick = () => fitView(true);
})();

/* ============ Detail panel – springs in from the right, can be flicked away ============ */
const panelX = spring(1, { eps: 0.002, response: 0.42 }); /* 0 = open, 1 = closed (fraction of the width) */
const panelEl = $("#panel");
const panelW = () => panelEl.offsetWidth + 24;
panelX.onUpdate = v => { panelEl.style.transform = `translateX(${(v * panelW()).toFixed(1)}px)`; };
panelX.onRest = () => { panelEl.dataset.state = panelX.value >= 0.999 ? "closed" : "open"; };
function openPanel() { panelEl.dataset.state = "open"; panelX.to(0, { damping: 0.86 }); }
function closePanel() { panelX.to(1, { damping: 1 }); }
(function setupPanelDrag() {
  let d = null;
  const start = e => {
    if (e.target.closest("button,a")) return;
    panelX.stop(); d = { x: e.clientX, v0: panelX.value, hist: [{ x: e.clientX, t: e.timeStamp }] };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = e => {
    if (!d) return; const W = panelW();
    let off = d.v0 * W + (e.clientX - d.x);
    if (off < 0) off = rubber(off, W); /* soft resistance to the left */
    panelX.set(off / W);
    d.hist.push({ x: e.clientX, t: e.timeStamp }); if (d.hist.length > 6) d.hist.shift();
  };
  const end = e => {
    if (!d) return; const W = panelW(), h = d.hist, a = h[0], b = h[h.length - 1];
    const v = b.t > a.t ? (b.x - a.x) / ((b.t - a.t) / 1000) : 0; d = null;
    const projected = panelX.value * W + project(v, 0.99);
    if (projected > W * 0.4) { panelX.to(1, { velocity: v / W, damping: 1 }); SELECTED = null; highlight(null); }
    else panelX.to(0, { velocity: v / W, damping: 0.86 });
  };
  for (const id of ["#panelHead"]) { const h = $(id); h.addEventListener("pointerdown", start); h.addEventListener("pointermove", move); h.addEventListener("pointerup", end); h.addEventListener("pointercancel", end); }
})();
addEventListener("keydown", e => {
  if (e.key === "Escape") { if ($("#tokenPop").dataset.open === "true") toggleToken(false); else if (SELECTED || GUIDE || TOUR || LOCK) select(null); }
  if (TOUR && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || "")) {
    if (e.key === "ArrowRight" && TOUR.i < TOUR.steps.length - 1) { e.preventDefault(); TOUR.i++; renderTour(); }
    if (e.key === "ArrowLeft" && TOUR.i > 0) { e.preventDefault(); TOUR.i--; renderTour(); }
  }
  if (e.key === "/" && document.activeElement?.tagName !== "INPUT") { e.preventDefault(); $("#repoInput").focus(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#repoInput").focus(); $("#repoInput").select(); }
  const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName || "");
  if (TAB === "arch" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const st = $("#stage");
    if (e.key === "f" || e.key === "F") { e.preventDefault(); fitView(true); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(1.25, st.clientWidth / 2, st.clientHeight / 2); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomBy(0.8, st.clientWidth / 2, st.clientHeight / 2); }
  }
});

function select(id) {
  SELECTED = id; LOCK = false; TOUR = null; highlight(id);
  if (!id) { GUIDE = false; closePanel(); return; }
  const ast = currentAst();
  const an = ast.nodes.find(n => n.id === id); if (!an) return;
  const head = $("#panelHead"), body = $("#panelBody"); head.textContent = ""; body.textContent = "";
  panelEl.style.setProperty("--c", `var(--c-${an.cat})`);
  head.append(el("span", { class: "ico" }, catIcon(an.cat)),
    el("div", { class: "t" }, el("h2", {}, an.label), el("span", { class: "pill" }, el("i"), CATS[an.cat].label)),
    closeBtn());
  if (GUIDE) body.append(el("button", { class: "backlink", type: "button", onclick: openGuide }, "← Architecture guide"));
  const info = MODE === "heur" ? EXPLAIN?.nodeInfo.get(id) : null;
  if (info) {
    body.append(el("p", { class: "desc role" }, info.role));
    if (info.doc) body.append(el("blockquote", { class: "quote" }, el("span", {}, info.doc.d), el("cite", {}, "— comment in " + basename(info.doc.file))));
    if (info.exports.length) body.append(el("div", { class: "sec" }, el("h4", {}, "Defines"), el("div", { class: "chips" }, ...info.exports.map(x => el("span", { class: "chip mono" }, x)))));
  }

  const files = MODE === "heur" ? (heurNode(id)?.files || []) : (an.path ? A.files.filter(f => f.path === an.path || f.path.startsWith(an.path.replace(/\/$/, "") + "/")) : []);
  if (an.desc) body.append(el("p", { class: "desc" }, an.desc));
  if (MODE === "heur" && an.file && an.parentId) body.append(el("div", { class: "sec" }, el("h4", {}, "Part of"), el("div", { class: "rows" },
    el("button", { class: "r", type: "button", onclick: () => { select(an.parentId); centerOn(an.parentId); } }, el("span", { class: "d", style: `background:var(--c-${ast.nodes.find(x => x.id === an.parentId)?.cat || an.cat})` }), el("span", { class: "n" }, an.parentLabel), el("span", { class: "v" }, "Folder"), el("span", { class: "ar" }, "→")))));
  /* Key figures */
  if (files.length) {
    const bytes = files.reduce((a, f) => a + f.size, 0);
    body.append(el("div", { class: "tiles" },
      el("div", { class: "tile" }, el("b", {}, fmtInt(files.length)), el("span", {}, "Files")),
      el("div", { class: "tile" }, el("b", {}, fmtBytes(bytes)), el("span", {}, "Size")),
      el("div", { class: "tile" }, el("b", {}, fmtInt(files.filter(f => isTest(f.path)).length)), el("span", {}, "Tests"))));
  }
  /* Path */
  const isDir = an.path ? !A.fileSet.has(an.path) : false;
  const u = an.path ? repoUrl(an.path, isDir) : null;
  if (an.kind === "comp" || MODE === "ai") body.append(el("div", { class: "sec" }, el("h4", {}, "Path"),
    el("div", { class: "pathbox" }, svgUse(isDir || !an.path ? "i-folder" : "i-file"),
      u ? el("a", { href: u, target: "_blank", rel: "noopener", style: "flex:1" }, an.path) : el("span", { style: "flex:1" }, an.path || (MODE === "ai" ? "External service – no path in the repo" : "/ (root)")),
      u ? svgUse("i-ext") : null)));
  /* Languages */
  if (files.length) {
    const bytes = files.reduce((a, f) => a + f.size, 0);
    const lang = new Map(); files.forEach(f => { const [n, c] = langOf(f.path); const o = lang.get(n) || { n, c, b: 0 }; o.b += f.size; lang.set(n, o); });
    const ls = [...lang.values()].sort((a, b) => b.b - a.b);
    const bar = el("div", { class: "minibar" }, ...ls.map(l => el("i", { style: `width:${(l.b / bytes * 100).toFixed(2)}%;background:${l.c}` })));
    body.append(el("div", { class: "sec" }, el("h4", {}, "Languages"), bar,
      el("div", { class: "rows" }, ...ls.slice(0, 4).map(l => el("div", { class: "r" }, el("span", { class: "d", style: `background:${l.c}` }), el("span", { class: "n" }, l.n), el("span", { class: "v" }, (l.b / bytes * 100).toFixed(0) + "%"))))));
  }
  /* Connections */
  const outE = ast.edges.filter(e => e.from === id), inE = ast.edges.filter(e => e.to === id);
  const conn = (title, arr, key) => {
    if (!arr.length) return null;
    return el("div", { class: "sec" }, el("h4", {}, title), el("div", { class: "rows" }, ...arr.map(e => {
      const o = ast.nodes.find(n => n.id === e[key]); if (!o) return null;
      return el("button", { class: "r", type: "button", onclick: () => { select(o.id); centerOn(o.id); } },
        el("span", { class: "d", style: `background:var(--c-${o.cat})` }), el("span", { class: "n" }, o.label), el("span", { class: "v" }, (e.label || "") + (e.w && MODE === "heur" ? ` · ${e.w}` : "")), el("span", { class: "ar" }, "→"));
    })));
  };
  const c1 = conn(MODE === "heur" ? "Uses" : "Connects to", outE, "to"), c2 = conn(MODE === "heur" ? "Used by" : "Connected from", inE, "from");
  if (c1) body.append(c1); if (c2) body.append(c2);
  if (!c1 && !c2) body.append(el("p", { class: "empty-note" }, MODE === "heur" ? "No detected imports to other components." : "No connections."));
  /* Largest files */
  if (files.length) {
    body.append(el("div", { class: "sec" }, el("h4", {}, "Largest files"), el("div", { class: "rows" }, ...[...files].sort((a, b) => b.size - a.size).slice(0, 7).map(f => {
      const fu = repoUrl(f.path, false); const short = an.path && f.path.startsWith(an.path + "/") ? f.path.slice(an.path.length + 1) : f.path;
      return el("div", { class: "r f" }, el("span", { class: "d", style: `background:${langOf(f.path)[1]}` }), fu ? el("a", { class: "n", href: fu, target: "_blank", rel: "noopener", title: f.path }, short) : el("span", { class: "n", title: f.path }, short), el("span", { class: "v" }, fmtBytes(f.size)));
    }))));
  }
  openPanel();
}
/* Gently bring a card to the center (leaving room for the panel) */
function centerOn(id) {
  const c = CARD_ELS.get(id); if (!c) return;
  const st = $("#stage"), s = Math.max(view.s.target, 0.8);
  view.s.to(s);
  const cx = parseFloat(c.style.left) + c.offsetWidth / 2, cy = parseFloat(c.style.top) + c.offsetHeight / 2;
  const free = st.clientWidth - (st.clientWidth > 760 ? panelEl.offsetWidth + 20 : 0);
  view.x.to(free / 2 - cx * s); view.y.to(st.clientHeight / 2 - cy * s);
}

/* ============ Architecture guide & tour (no AI: derived from code and docs) ============ */
let EXPLAIN = null, GUIDE = false, TOUR = null, LOCK = false;
const nodeOf = id => currentAst().nodes.find(n => n.id === id);
const closeBtn = () => el("button", { class: "close", type: "button", "aria-label": "Close", onclick: () => select(null) }, svgUse("i-x"));

function highlightPath(ids) {
  const set = new Set(ids), pairs = new Set(ids.slice(1).map((id, i) => ids[i] + ">" + id));
  $("#canvas").classList.remove("preview");
  CARD_ELS.forEach((c, id) => { c.classList.toggle("sel", set.has(id)); c.classList.toggle("dim", !set.has(id)); });
  GROUP_ELS.forEach(g => g.el.classList.add("dim"));
  EDGE_ELS.forEach(({ e, base, flow, label }) => {
    const hot = pairs.has(e.from + ">" + e.to);
    for (const x of [base, flow]) { x.classList.toggle("hot", hot); x.classList.toggle("dim", !hot); }
    base.setAttribute("marker-end", hot ? "url(#arrHot)" : "url(#arr)");
    if (label) { label.classList.toggle("hot", hot); label.classList.toggle("dim", !hot); }
  });
}
/* Point the camera at a group of cards (leaving room for the panel) */
function focusNodes(ids) {
  const st = $("#stage"), cs = ids.map(id => CARD_ELS.get(id)).filter(Boolean); if (!cs.length) return;
  const x0 = Math.min(...cs.map(c => parseFloat(c.style.left))), y0 = Math.min(...cs.map(c => parseFloat(c.style.top)));
  const x1 = Math.max(...cs.map(c => parseFloat(c.style.left) + c.offsetWidth)), y1 = Math.max(...cs.map(c => parseFloat(c.style.top) + c.offsetHeight));
  const free = st.clientWidth - (st.clientWidth > 760 ? panelEl.offsetWidth + 30 : 0), fh = st.clientHeight;
  const s = Math.min(1, Math.max(0.35, Math.min((free - 80) / Math.max(1, x1 - x0), (fh - 170) / Math.max(1, y1 - y0))));
  view.s.to(s); view.x.to(free / 2 - (x0 + x1) / 2 * s); view.y.to(fh / 2 - (y0 + y1) / 2 * s + 24);
}
function showPath(path) { LOCK = true; SELECTED = null; highlightPath(path); focusNodes(path); }

function pathChips(path) {
  return el("span", { class: "fp" }, ...path.flatMap((id, i) => { const n = nodeOf(id); return [i ? el("span", { class: "arr" }, "→") : null, el("span", { class: "fn", style: `--c:var(--c-${n?.cat || "core"})` }, n?.label || id)]; }));
}
function renderBlocks(blocks) {
  const out = []; let ul = null;
  for (const b of blocks) {
    if (b.t === "li") { if (!ul) { ul = el("ul", { class: "md" }); out.push(ul); } ul.append(el("li", {}, b.s)); }
    else { ul = null; out.push(el("p", {}, b.s)); }
  }
  return out;
}
function openGuide() {
  if (!EXPLAIN) return;
  if (TAB !== "arch") switchTab("arch");
  GUIDE = true; TOUR = null; LOCK = false; SELECTED = null; highlight(null);
  const head = $("#panelHead"), body = $("#panelBody"); head.textContent = ""; body.textContent = "";
  panelEl.style.setProperty("--c", "var(--accent)");
  head.append(el("span", { class: "ico" }, svgUse("i-book")), el("div", { class: "t" }, el("h2", {}, "Architecture guide"), el("span", { class: "pill" }, el("i"), "Derived from code & docs")), closeBtn());

  body.append(el("div", { class: "sec g-sum" }, ...EXPLAIN.summary.map(t => el("p", {}, t))));
  if (EXPLAIN.tour.length > 1) body.append(el("button", { class: "btn primary tourbtn", type: "button", onclick: () => startTour(0) }, svgUse("i-play"), `Take the tour · ${EXPLAIN.tour.length} stops`));

  if (EXPLAIN.flows.length) body.append(el("div", { class: "sec" }, el("h4", {}, "Main flows"),
    ...EXPLAIN.flows.map(f => el("button", { class: "gflow", type: "button", onclick: () => showPath(f.path) }, el("span", { class: "fh" }, f.title), pathChips(f.path), el("span", { class: "fx" }, f.text)))));

  body.append(el("div", { class: "sec" }, el("h4", {}, "Layers"), ...EXPLAIN.layers.map(l => el("div", { class: "layer" },
    el("div", { class: "lh" }, el("b", {}, l.title), el("span", { class: "muted" }, `${l.nodes.length}`)), el("p", {}, l.desc),
    el("div", { class: "lchips" }, ...l.nodes.map(id => { const n = nodeOf(id); return el("button", { class: "lchip", type: "button", style: `--c:var(--c-${n?.cat || "core"})`, onclick: () => { select(id); centerOn(id); } }, el("i"), n?.label || id); }))))));

  if (EXPLAIN.start.length) body.append(el("div", { class: "sec" }, el("h4", {}, "Where to start reading"), el("ol", { class: "start" },
    ...EXPLAIN.start.map(s => { const u = repoUrl(s.path, false); return el("li", {},
      el("button", { class: "sname", type: "button", onclick: () => { select(s.id); centerOn(s.id); } }, nodeOf(s.id)?.label || s.path),
      u ? el("a", { class: "spath mono", href: u, target: "_blank", rel: "noopener" }, s.path) : el("span", { class: "spath mono" }, s.path),
      el("span", { class: "swhy" }, s.why)); }))));

  const docSec = el("div", { class: "sec" }, el("h4", {}, "What the authors say"));
  if (EXPLAIN.docs.length) for (const d of EXPLAIN.docs) {
    docSec.append(el("div", { class: "doc" },
      el("div", { class: "dh" }, el("b", {}, d.title), d.url ? el("a", { href: d.url, target: "_blank", rel: "noopener" }, d.source, svgUse("i-ext")) : el("span", { class: "muted" }, d.source)),
      ...renderBlocks(d.blocks),
      d.rels.length ? el("div", { class: "rels" }, el("span", { class: "muted" }, "Diagram by the authors"), ...d.rels.map(r => el("div", { class: "rel" + (r.dotted ? " dotted" : "") }, el("span", {}, r.a), el("span", { class: "arr" }, "→"), el("span", {}, r.b), r.label ? el("em", {}, r.label) : null))) : null));
  } else docSec.append(el("p", { class: "empty-note" }, "No architecture section found. Add an “Architecture” or “How it's built” section to the README, or a docs/architecture.md, and it will show up here."));
  body.append(docSec);
  openPanel();
}

function startTour(i) { if (!EXPLAIN?.tour.length) return; TOUR = { i, steps: EXPLAIN.tour }; renderTour(); }
function renderTour() {
  const { i, steps } = TOUR, id = steps[i], n = nodeOf(id), info = EXPLAIN.nodeInfo.get(id);
  if (!n) return;
  LOCK = true; SELECTED = null; highlight(id); centerOn(id);
  const head = $("#panelHead"), body = $("#panelBody"); head.textContent = ""; body.textContent = "";
  panelEl.style.setProperty("--c", `var(--c-${n.cat})`);
  head.append(el("span", { class: "ico" }, n.file ? svgUse("i-file") : catIcon(n.cat)), el("div", { class: "t" }, el("h2", {}, n.label), el("span", { class: "pill" }, el("i"), `Tour · stop ${i + 1} of ${steps.length}`)), closeBtn());
  body.append(el("div", { class: "dots" }, ...steps.map((s, k) => el("button", { class: "dot" + (k === i ? " on" : k < i ? " done" : ""), type: "button", "aria-label": `Stop ${k + 1}: ${nodeOf(s)?.label}`, onclick: () => { TOUR.i = k; renderTour(); } }))));
  if (info) {
    body.append(el("p", { class: "desc role big" }, info.role));
    if (info.doc) body.append(el("blockquote", { class: "quote" }, el("span", {}, info.doc.d), el("cite", {}, "— comment in " + basename(info.doc.file))));
    if (info.exports.length) body.append(el("div", { class: "sec" }, el("h4", {}, "Defines"), el("div", { class: "chips" }, ...info.exports.map(x => el("span", { class: "chip mono" }, x)))));
  }
  const outE = currentAst().edges.filter(e => e.from === id).slice(0, 5);
  if (outE.length) body.append(el("div", { class: "sec" }, el("h4", {}, "Next it"), el("div", { class: "rows" }, ...outE.map(e => el("div", { class: "r" }, el("span", { class: "d", style: `background:var(--c-${nodeOf(e.to)?.cat})` }), el("span", { class: "n" }, `${e.label || "uses"} ${nodeOf(e.to)?.label || ""}`))))));
  body.append(el("div", { class: "tournav" },
    el("button", { class: "btn", type: "button", disabled: i === 0 ? "" : null, onclick: () => { TOUR.i--; renderTour(); } }, "← Back"),
    el("button", { class: "btn ghostlink", type: "button", onclick: () => { const keep = id; TOUR = null; select(keep); } }, "Details"),
    i < steps.length - 1 ? el("button", { class: "btn primary", type: "button", onclick: () => { TOUR.i++; renderTour(); } }, "Next →") : el("button", { class: "btn primary", type: "button", onclick: () => openGuide() }, "Finish")));
  body.append(el("p", { class: "hint" }, "Use ← and → to move through the tour, Esc to end it."));
  openPanel();
}

/* ============ Treemap ============ */
let tmRoot = "";
function buildHierarchy(prefix) {
  const root = { name: prefix || DATA.repo, path: prefix, children: [] };
  const idx = new Map([["", root]]);
  const rel = A.files.filter(f => !prefix || f.path.startsWith(prefix + "/"));
  const MAXDEPTH = 3;
  for (const f of rel) {
    const r = prefix ? f.path.slice(prefix.length + 1) : f.path;
    const segs = r.split("/"); let cur = root, acc = "";
    const depth = Math.min(segs.length - 1, MAXDEPTH);
    for (let i = 0; i < depth; i++) {
      acc = acc ? acc + "/" + segs[i] : segs[i];
      if (!idx.has(acc)) { const n = { name: segs[i], path: (prefix ? prefix + "/" : "") + acc, children: [], dir: true }; idx.set(acc, n); cur.children.push(n); }
      cur = idx.get(acc);
    }
    if (segs.length - 1 > MAXDEPTH) {
      cur.agg = cur.agg || { name: "…", path: cur.path, size: 0, aggregate: true, langs: new Map() };
      cur.agg.size += f.size; const lc = langOf(f.path)[1]; cur.agg.langs.set(lc, (cur.agg.langs.get(lc) || 0) + f.size);
    } else cur.children.push({ name: segs[segs.length - 1], path: f.path, size: f.size });
  }
  for (const n of idx.values()) if (n.agg) n.children.push(n.agg);
  return root;
}
function textOn(hex) { const c = parseInt(hex.slice(1), 16); const r = c >> 16, g = c >> 8 & 255, b = c & 255; return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#16131f" : "#ffffff"; }
function renderTreemap() {
  const box = $("#tm"); box.textContent = "";
  if (!A || typeof d3 === "undefined") return;
  const W = box.clientWidth, H = box.clientHeight; if (!W || !H) return;
  const h = d3.hierarchy(buildHierarchy(tmRoot)).sum(d => d.size || 0).sort((a, b) => b.value - a.value);
  d3.treemap().size([W, H]).paddingInner(3).paddingOuter(d => d.depth > 0 ? 3 : 0).paddingTop(d => d.depth > 0 && d.children ? 20 : 0).round(true)(h);
  const tip = $("#tip"); let i = 0;
  for (const d of h.descendants()) {
    if (d.depth === 0) continue;
    const w = d.x1 - d.x0, hh = d.y1 - d.y0; if (w < 2 || hh < 2) continue;
    const isDir = !!d.children;
    const color = isDir ? null : d.data.aggregate ? [...d.data.langs.entries()].sort((a, b) => b[1] - a[1])[0][0] : langOf(d.data.path)[1];
    const t = el("div", { class: "t " + (isDir ? "dir" : "leaf"), style: `left:${d.x0}px;top:${d.y0}px;width:${w}px;height:${hh}px;${color ? `background:${color};color:${textOn(color)}` : ""}` });
    if (w > 30 && hh > 14) t.textContent = d.data.name;
    const info = `${d.data.aggregate ? d.data.path + "/… (deeper levels)" : d.data.path}\n${fmtBytes(d.value)}${isDir ? " · " + d.leaves().length + " entries" : ""}`;
    t.addEventListener("mousemove", e => { tip.hidden = false; tip.textContent = info; tip.style.left = Math.min(e.clientX + 14, innerWidth - 370) + "px"; tip.style.top = (e.clientY + 16) + "px"; e.stopPropagation(); });
    t.addEventListener("mouseleave", () => { tip.hidden = true; });
    if (isDir || d.data.aggregate) t.addEventListener("click", e => { e.stopPropagation(); tip.hidden = true; zoomTreemap(d.data.path, d); });
    else { const u = repoUrl(d.data.path, false); if (u) t.addEventListener("click", () => window.open(u, "_blank", "noopener")); }
    if (!REDUCE.matches && i < 600) t.animate([{ opacity: 0, transform: "scale(.96)" }, { opacity: 1, transform: "none" }], { duration: 420, delay: Math.min(260, d.depth * 60 + (i % 40) * 4), easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" });
    i++; box.append(t);
  }
  const cr = $("#tmCrumbs"); cr.textContent = "";
  cr.append(el("button", { type: "button", onclick: () => zoomTreemap("") }, DATA.repo.split("/").pop()));
  if (tmRoot) { let acc = ""; for (const s of tmRoot.split("/")) { acc = acc ? acc + "/" + s : s; const p = acc; cr.append(el("span", { class: "s" }, "/"), el("button", { type: "button", onclick: () => zoomTreemap(p) }, s)); } }
}
/* Zooming in: the clicked folder grows from its position to the full area */
function zoomTreemap(path, d) {
  const box = $("#tm");
  if (d && !REDUCE.matches) {
    const W = box.clientWidth, H = box.clientHeight;
    const sx = (d.x1 - d.x0) / W, sy = (d.y1 - d.y0) / H;
    tmRoot = path; renderTreemap();
    box.animate([{ transformOrigin: "0 0", transform: `translate(${d.x0}px,${d.y0}px) scale(${sx},${sy})`, opacity: .6 }, { transformOrigin: "0 0", transform: "none", opacity: 1 }], { duration: 480, easing: "cubic-bezier(.16,1,.3,1)" });
  } else { tmRoot = path; renderTreemap(); }
}

/* ============ File tree ============ */
let openDirs = new Set();
function renderFiles() {
  const q = $("#fileSearch").value.trim().toLowerCase();
  const box = $("#files"); box.textContent = "";
  if (!A) return;
  const match = A.files.filter(f => !q || f.path.toLowerCase().includes(q));
  $("#fileCount").textContent = `${fmtInt(match.length)} of ${fmtInt(A.files.length)} files`;
  const tree = { c: new Map(), size: 0, n: 0 };
  for (const f of match) { let cur = tree; const segs = f.path.split("/"); cur.size += f.size; cur.n++;
    segs.forEach((s, i) => { if (i === segs.length - 1) { cur.c.set(s, { f }); return; } if (!cur.c.has(s)) cur.c.set(s, { c: new Map(), size: 0, n: 0 }); cur = cur.c.get(s); cur.size += f.size; cur.n++; }); }
  let rows = 0; const LIMIT = 1500;
  const walk = (node, path, depth) => {
    const entries = [...node.c.entries()].sort((a, b) => (!!b[1].c - !!a[1].c) || a[0].localeCompare(b[0]));
    for (const [name, ch] of entries) {
      if (rows++ > LIMIT) return;
      const p = path ? path + "/" + name : name;
      if (ch.c) {
        const open = q ? true : openDirs.has(p);
        box.append(el("div", { class: "r d", style: `padding-left:${10 + depth * 16}px`, onclick: () => { openDirs.has(p) ? openDirs.delete(p) : openDirs.add(p); renderFiles(); } },
          el("span", { class: "tw" + (open ? " open" : "") }, "›"), svgUse("i-folder"), el("span", { class: "nm" }, name), el("span", { class: "ct" }, ch.n), el("span", { class: "sz" }, fmtBytes(ch.size))));
        if (open) walk(ch, p, depth + 1);
      } else {
        const u = repoUrl(p, false);
        box.append(el("div", { class: "r", style: `padding-left:${10 + depth * 16}px` }, el("span", { class: "tw" }), el("i", { class: "ld", style: `background:${langOf(p)[1]}` }),
          u ? el("a", { class: "nm", href: u, target: "_blank", rel: "noopener" }, name) : el("span", { class: "nm" }, name), isTest(p) ? el("span", { class: "tst" }, "Test") : null, el("span", { class: "sz" }, fmtBytes(ch.f.size))));
      }
    }
  };
  walk(tree, "", 0);
  if (rows > LIMIT) box.append(el("div", { class: "r muted" }, "List truncated – use the filter."));
}
$("#fileSearch").addEventListener("input", renderFiles);

/* ============ Screening dashboard ============ */
function renderHealth() {
  const g = $("#healthGrid"); g.textContent = ""; if (!A) return;
  const C = 2 * Math.PI * 38;
  const bad = A.checks.filter(c => c.s === "bad").length, warn = A.checks.filter(c => c.s === "warn").length, ok = A.checks.filter(c => c.s === "ok").length;
  const ring = el("svg", {}); ring.outerHTML; /* placeholder */
  const ringWrap = document.createElement("div");
  ringWrap.innerHTML = `<svg class="ring" viewBox="0 0 92 92" aria-hidden="true"><circle class="bg" cx="46" cy="46" r="38"/><circle class="fg" cx="46" cy="46" r="38" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - A.score / 100)).toFixed(2)}" transform="rotate(-90 46 46)"/></svg>`;
  const fg = ringWrap.querySelector(".fg");
  if (!REDUCE.matches) fg.animate([{ strokeDashoffset: C }, { strokeDashoffset: C * (1 - A.score / 100) }], { duration: 1100, easing: "cubic-bezier(.16,1,.3,1)" });
  const cnt = (n, l, v) => n ? el("span", { style: `color:var(--${v});background:color-mix(in srgb,var(--${v}) 14%,transparent)` }, `${n} ${l}`) : null;
  const scoreNum = el("span", {}, "0");
  g.append(el("div", { class: "box span5" }, el("h3", {}, "Project health", el("small", {}, "10 checks")),
    el("div", { class: "scorebox" }, ringWrap.firstElementChild,
      el("div", {}, el("div", { class: "big" }, scoreNum, el("small", {}, " / 100")),
        el("p", {}, bad ? "There are critical issues worth a look." : warn ? "Solid foundation with a few notes." : "All checks passed."),
        el("div", { class: "counts" }, cnt(ok, "passed", "ok"), cnt(warn, "note" + (warn > 1 ? "s" : ""), "warn"), cnt(bad, "critical", "bad"))))));
  countUp(scoreNum, A.score);

  const lw = el("div", { class: "box span7", style: "animation-delay:.05s" }, el("h3", {}, "Languages", el("small", {}, "by file size")));
  lw.append(el("div", { class: "langbar" }, ...A.langs.map((l, i) => el("i", { style: `width:${(l.bytes / A.total * 100).toFixed(3)}%;background:${l.color};animation-delay:${i * 40}ms`, title: l.name }))));
  lw.append(el("div", { class: "rows", style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:0 18px" }, ...A.langs.slice(0, 10).map(l =>
    el("div", { class: "r" }, el("span", { class: "d", style: `background:${l.color}` }), el("span", { class: "n" }, l.name), el("span", { class: "v" }, (l.bytes / A.total * 100).toFixed(1) + "%")))));
  g.append(lw);

  g.append(el("div", { class: "box span12", style: "animation-delay:.1s" }, el("h3", {}, "Checks"),
    el("ul", { class: "checks" }, ...A.checks.map(c => el("li", { class: c.s }, el("span", { class: "st" }, c.s === "ok" ? "✓" : c.s === "warn" ? "!" : c.s === "bad" ? "✕" : "–"), el("b", {}, c.t), el("span", { class: "why" }, c.w))))));

  g.append(el("div", { class: "box span4", style: "animation-delay:.15s" }, el("h3", {}, "Stack", el("small", {}, A.stack.length + " detected")),
    A.stack.length ? el("div", { class: "chips" }, ...A.stack.map(s => el("span", { class: "chip" }, s))) : el("p", { class: "empty-note" }, "No known stack detected.")));

  const ast = heuristicAst(A); const deg = new Map(); ast.edges.forEach(e => deg.set(e.to, (deg.get(e.to) || 0) + (e.w || 1)));
  const hubs = [...deg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  g.append(el("div", { class: "box span4", style: "animation-delay:.2s" }, el("h3", {}, "Most used", el("small", {}, "incoming imports")),
    hubs.length ? el("div", { class: "rows" }, ...hubs.map(([id, w]) => { const n = ast.nodes.find(x => x.id === id);
      return el("button", { class: "r", type: "button", onclick: () => { switchTab("arch"); setTimeout(() => { select(id); centerOn(id); }, 60); } },
        el("span", { class: "d", style: `background:var(--c-${n.cat})` }), el("span", { class: "n" }, n.label), el("span", { class: "v" }, fmtInt(w)), el("span", { class: "ar" }, "→")); }))
      : el("p", { class: "empty-note" }, "No imports analyzed.")));

  g.append(el("div", { class: "box span4", style: "animation-delay:.25s" }, el("h3", {}, "Largest files", el("small", {}, "hotspots")),
    el("div", { class: "rows" }, ...[...A.files].sort((a, b) => b.size - a.size).slice(0, 8).map(f => { const u = repoUrl(f.path, false);
      return el("div", { class: "r f" }, el("span", { class: "d", style: `background:${langOf(f.path)[1]}` }), u ? el("a", { class: "n", href: u, target: "_blank", rel: "noopener", title: f.path }, f.path) : el("span", { class: "n", title: f.path }, f.path), el("span", { class: "v" }, fmtBytes(f.size))); }))));

  const notes = [];
  if (DATA.truncated) notes.push("GitHub returned a truncated file tree, so very large repos are incomplete.");
  if (DATA.source === "github" && A.analysed) notes.push(`Imports come from a sample of ${A.analysed} source files.`);
  if (DATA.source === "sample") notes.push("Example data: file tree and imports of ahmedkhaleel2004/gitdiagram, captured on November 2, 2026.");
  if (notes.length) g.append(el("div", { class: "box span12", style: "animation-delay:.3s" }, el("h3", {}, "Hinweise"), ...notes.map(t => el("div", { class: "notice" }, t))));
}
function countUp(node, to) {
  if (REDUCE.matches) { node.textContent = to; return; }
  const t0 = performance.now(), D = 1000;
  const f = now => { const p = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - p, 4); node.textContent = Math.round(to * e); if (p < 1) requestAnimationFrame(f); };
  requestAnimationFrame(f);
}

/* ============ Tabs & controls ============ */
function switchTab(t) {
  if (t === TAB) return;
  TAB = t;
  document.querySelectorAll(".tab").forEach(x => x.setAttribute("aria-selected", x.dataset.tab === TAB ? "true" : "false"));
  document.querySelectorAll("[data-view]").forEach(v => { const on = v.dataset.view === TAB; v.hidden = !on; v.classList.toggle("enter", on); });
  moveTabInd(true);
  if (TAB !== "arch" && SELECTED) select(null);
  if (TAB === "tree") renderTreemap();
  if (TAB === "files") renderFiles();
  if (TAB === "health") renderHealth();
  if (TAB === "arch") requestAnimationFrame(() => { knobMode(false); knobDir(false); });
}
document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));
function setMode(m) {
  MODE = m; $("#modeHeur")?.setAttribute("aria-pressed", m === "heur"); $("#modeAi")?.setAttribute("aria-pressed", m === "ai"); knobMode();
  SELECTED = null; closePanel(); renderCanvas();
}
$("#guideBtn").onclick = () => GUIDE && !TOUR ? select(null) : openGuide();
$("#explainBtn").onclick = () => openGuide();
$("#sideBtn").onclick = () => { SHOW_SIDE = !SHOW_SIDE; renderCanvas(); };
const setDir = m => { DIR_MODE = m; if (m !== "auto") DIR = m; renderCanvas(); };
$("#dirAuto").onclick = () => setDir("auto"); $("#dirTD").onclick = () => setDir("TD"); $("#dirLR").onclick = () => setDir("LR");
$("#copyMm").onclick = async () => {
  const b = $("#copyMm"), src = compileMermaid(currentAst(), DIR);
  const done = ok => { b.title = ok ? "Copied" : "Copy failed"; b.animate([{ transform: "scale(.9)" }, { transform: "scale(1.08)" }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(.16,1,.3,1)" }); toast(ok ? "Mermaid source copied" : "Copy failed"); };
  try { await navigator.clipboard.writeText(src); done(true); }
  catch { const ta = el("textarea", { style: "position:fixed;left:-9999px" }); ta.value = src; document.body.append(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch {} ta.remove(); done(ok); }
};
function toggleToken(open) {
  const p = $("#tokenPop"), o = open ?? p.dataset.open !== "true";
  p.dataset.open = o; $("#tokenBtn").setAttribute("aria-expanded", o);
  if (o) setTimeout(() => $("#tokenInput").focus(), 30);
}
$("#tokenBtn").onclick = e => { e.stopPropagation(); toggleToken(); };
document.addEventListener("pointerdown", e => { if (!e.target.closest(".anchor") && $("#tokenPop").dataset.open === "true") toggleToken(false); });

/* ============ Analysis log (build log) & toasts ============ */
let logHide = 0;
function logStart(title = "Analyzing") {
  clearTimeout(logHide);
  const l = $("#log"); l.dataset.open = "true"; $("#logBody").textContent = ""; $("#logTitle").textContent = title; $("#logSt").className = "st";
}
function logStep(text, cls = "") { const r = el("div", { class: "row " + cls }, el("i", {}, cls === "err" ? "✕" : cls === "done" ? "✓" : "›"), el("span", {}, text)); $("#logBody").append(r); $("#logBody").scrollTop = 1e6; if (cls === "err") { $("#logSt").className = "st err"; $("#logTitle").textContent = "Analysis failed"; } return r; }
function logDone(r, text) { r.className = "row done"; r.firstChild.textContent = "✓"; if (text) r.lastChild.textContent = text; }
function logFinish(text) { $("#logSt").className = "st ok"; $("#logTitle").textContent = text || "Analysis complete"; logHide = setTimeout(() => { $("#log").dataset.open = "false"; }, 3800); }
$("#logClose").onclick = () => { $("#log").dataset.open = "false"; };
function toast(text) { logStart(text); $("#logBody").append(el("div", { class: "row done" }, el("i", {}, "✓"), el("span", {}, text))); logFinish(text); }

/* ============ Show everything ============ */
function show(data) {
  DATA = data; A = analyze(data); AI = null; EXPLAIN = explainArchitecture(A, data); GUIDE = false; TOUR = null; LOCK = false; SELECTED = null; tmRoot = ""; openDirs = new Set();
  MODE = "heur";
  panelX.set(1); panelEl.dataset.state = "closed";
  EXT.onShow.forEach(f => f());
  renderHeader();
  if (TAB !== "arch") switchTab("arch");
  requestAnimationFrame(() => { renderCanvas(); knobMode(false); knobDir(false); moveTabInd(false); });
}
/* ============ Search field: accessible combobox with suggestions, live detection and animations ============ */
const Search = (() => {
  const form = $("#loadForm"), input = $("#repoInput"), list = $("#repoList"), msg = $("#repoMsg"), clear = $("#repoClear"), det = $("#repoDetected");
  const EXAMPLES = ["vercel/next.js", "FlorianBohrer/Todo_App", "ahmedkhaleel2004/gitdiagram", "fastapi/fastapi", "sveltejs/svelte", "supabase/supabase"];
  const RECENT_KEY = "rs-recent";
  const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").filter(x => typeof x === "string").slice(0, 5); } catch { return []; } };
  const remember = r => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([r, ...recent().filter(x => x.toLowerCase() !== r.toLowerCase())].slice(0, 5))); } catch {} };
  let options = [], active = -1;

  const canonical = v => { const p = parseRepo(v); return p && !/\s/.test(v.trim()) ? `${p.owner}/${p.repo}` : null; };
  const setMsg = (text, bad = true) => { msg.textContent = text; msg.style.color = bad ? "" : "var(--ok)"; msg.classList.toggle("show", !!text); form.setAttribute("aria-invalid", text && bad ? "true" : "false"); };
  const shake = () => { if (REDUCE.matches) return; form.classList.remove("shake"); void form.offsetWidth; form.classList.add("shake"); };
  const open = on => { list.dataset.open = on; input.setAttribute("aria-expanded", on); if (!on) { active = -1; input.removeAttribute("aria-activedescendant"); } };

  const highlightMatch = (text, q) => {
    const span = el("span", { class: "o-name" }), i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
    if (i < 0) span.textContent = text; else span.append(text.slice(0, i), el("mark", {}, text.slice(i, i + q.length)), text.slice(i + q.length));
    return span;
  };
  function render() {
    const raw = input.value.trim(), q = (canonical(raw) || raw).toLowerCase();
    const rec = recent(), seen = new Set();
    const pick = (arr, kind) => arr.filter(r => !seen.has(r.toLowerCase()) && (!q || r.toLowerCase().includes(q))).map(r => { seen.add(r.toLowerCase()); return { r, kind }; });
    const groups = [["Recent", pick(rec, "recent")], ["Examples", pick(EXAMPLES, "example")]];
    const typed = canonical(raw);
    if (typed && !seen.has(typed.toLowerCase())) groups.unshift(["Analyze", [{ r: typed, kind: "typed" }]]);
    list.textContent = ""; options = [];
    let k = 0;
    for (const [title, items] of groups) {
      if (!items.length) continue;
      const gid = "repoGrp" + title;
      list.append(el("li", { class: "grp-h", role: "presentation", id: gid }, title));
      for (const it of items) {
        const id = "repoOpt" + options.length;
        const li = el("li", { role: "option", id, "aria-selected": "false", style: `animation-delay:${Math.min(8, k++) * 22}ms` },
          svgUse(it.kind === "recent" ? "i-clock" : it.kind === "typed" ? "i-search" : "i-repo"), highlightMatch(it.r, q),
          el("span", { class: "o-meta" }, it.kind === "recent" ? "recent" : it.kind === "typed" ? "analyze" : "example"));
        li.addEventListener("pointerdown", e => { e.preventDefault(); choose(it.r); });
        li.addEventListener("pointermove", () => setActive(options.findIndex(o => o.li === li), false));
        list.append(li); options.push({ li, r: it.r });
      }
    }
    if (!options.length) list.append(el("li", { class: "o-empty", role: "presentation" }, raw ? "Press Enter to analyze" : "Type owner/repo or paste a GitHub URL"));
    if (active >= options.length) active = options.length - 1;
    setActive(active, false);
  }
  function setActive(i, scroll = true) {
    active = i;
    options.forEach((o, j) => o.li.setAttribute("aria-selected", j === i ? "true" : "false"));
    if (i >= 0 && options[i]) { input.setAttribute("aria-activedescendant", options[i].li.id); if (scroll) options[i].li.scrollIntoView({ block: "nearest" }); }
    else input.removeAttribute("aria-activedescendant");
  }
  function sync() {
    const v = input.value, has = v.trim().length > 0, c = canonical(v);
    form.classList.toggle("has-value", has); clear.hidden = !has;
    /* a pasted URL is visibly recognized as owner/repo */
    const showDet = !!c && c !== v.trim();
    if (showDet && det.textContent !== "→ " + c) { det.textContent = "→ " + c; det.hidden = false; det.style.animation = "none"; void det.offsetWidth; det.style.animation = ""; }
    if (!showDet) det.hidden = true;
    if (form.getAttribute("aria-invalid") === "true" && (c || !has)) setMsg("");
  }
  function choose(r) { input.value = r; sync(); open(false); form.requestSubmit(); }
  async function submit(e) {
    e.preventDefault();
    if (active >= 0 && options[active] && list.dataset.open === "true") { const r = options[active].r; input.value = r; }
    const c = canonical(input.value);
    if (!c) { setMsg(input.value.trim() ? "Use owner/repo or a GitHub URL, e.g. vercel/next.js" : "Enter a repository to analyze"); shake(); input.focus(); return; }
    setMsg(""); open(false);
    const b = $("#loadBtn"); b.disabled = true; b.classList.add("busy"); form.setAttribute("aria-busy", "true"); input.setAttribute("aria-busy", "true");
    try { const d = await loadGitHub(input.value); remember(d.repo); show(d); logFinish(`${d.repo} analyzed`); input.value = d.repo; sync(); input.blur(); }
    catch (err) { if ($("#log").dataset.open !== "true") logStart(); logStep(err.message || String(err), "err"); setMsg(err.message || "Analysis failed"); shake(); }
    finally { b.disabled = false; b.classList.remove("busy"); form.removeAttribute("aria-busy"); input.removeAttribute("aria-busy"); }
  }
  input.addEventListener("focus", () => { render(); open(true); });
  input.addEventListener("blur", () => setTimeout(() => open(false), 120));
  input.addEventListener("input", () => { sync(); active = -1; render(); open(true); });
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (list.dataset.open !== "true") { render(); open(true); } setActive(Math.min(options.length - 1, active + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(-1, active - 1)); }
    else if (e.key === "Escape") { if (list.dataset.open === "true") { e.stopPropagation(); open(false); } else if (input.value) { e.stopPropagation(); input.value = ""; sync(); setMsg(""); } else input.blur(); }
    else if (e.key === "Tab") open(false);
  });
  clear.addEventListener("click", () => { input.value = ""; sync(); setMsg(""); render(); open(true); input.focus(); });
  form.addEventListener("submit", submit);

  /* rolling placeholder: switches the example every 2.8 s (not with reduced motion, not while typing) */
  const roll = $("#repoPh .ph-roll"); let ex = 0;
  setInterval(() => {
    if (REDUCE.matches || document.hidden || form.classList.contains("has-value")) return;
    const cur = roll.querySelector(".ph-item.on"); ex = (ex + 1) % EXAMPLES.length;
    const next = el("span", { class: "ph-item" }, EXAMPLES[ex]); roll.append(next);
    requestAnimationFrame(() => { cur?.classList.replace("on", "out"); next.classList.add("on"); });
    setTimeout(() => cur?.remove(), 600);
  }, 2800);
  sync();
  return { sync };
})();
$("#dirInput").addEventListener("change", async e => {
  try { const d = await loadLocal(e.target.files); show(d); logFinish(`“${d.repo}” analyzed`); } catch (err) { logStart(); logStep(err.message || String(err), "err"); }
  e.target.value = "";
});
$("#sampleBtn").onclick = () => { $("#log").dataset.open = "false"; show(SAMPLE); };

/* ============ Resize & theme ============ */
let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { moveTabInd(false); knobMode(false); knobDir(false); if (TAB === "tree") renderTreemap(); if (TAB === "arch") fitView(true); }, 120); });
if (document.fonts?.ready) document.fonts.ready.then(() => { moveTabInd(false); knobMode(false); knobDir(false); });

/* ============ Start ============ */
const SAMPLE = (() => { try { const s = JSON.parse(document.getElementById("sample-data").textContent); s.source = "sample"; s.description = "Turns a GitHub repository into an interactive architecture diagram."; return s; } catch { return null; } })();
const qp = new URLSearchParams(location.search).get("repo");
if (qp) { $("#repoInput").value = qp; Search.sync(); $("#loadForm").requestSubmit(); }
else if (SAMPLE) show(SAMPLE);
