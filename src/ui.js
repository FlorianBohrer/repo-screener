/* ============ Zustand ============ */
let DATA = null, A = null, MODE = "heur", DIR = "TD", AI = null, SELECTED = null, TAB = "arch";
/* Optionale Erweiterungen (z. B. ein zweiter Diagramm-Modus) registrieren sich hier */
const EXT = { onShow: [], onLayout: [] };
const REDUCE = matchMedia("(prefers-reduced-motion: reduce)");
const currentAst = () => (MODE === "ai" && AI ? AI.ast : heuristicAst(A));

/* ============ Federn (kritisch gedämpft als Standard, unterbrechbar, Geschwindigkeit bleibt erhalten) ============ */
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
const project = (v, d = 0.996) => (v / 1000) * d / (1 - d); /* Apples Schwung-Projektion */
const rubber = (o, dim, c = 0.55) => (o * dim * c) / (dim + c * Math.abs(o));

/* ============ Kopf: Repo, Tabs mit federndem Indikator ============ */
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
/* Segment-Knopf mit federndem Hintergrund */
function segKnob(seg) {
  const knob = seg.querySelector(".knob"), sx = spring(0, { eps: 0.3, response: 0.32 }), sw = spring(0, { eps: 0.3, response: 0.32 });
  sx.onUpdate = sw.onUpdate = () => { knob.style.transform = `translateX(${sx.value}px)`; knob.style.width = sw.value + "px"; };
  return (animate = true) => { const b = seg.querySelector('button[aria-pressed="true"]'); if (!b) return;
    if (animate && sw.value) { sx.to(b.offsetLeft); sw.to(b.offsetWidth); } else { sx.set(b.offsetLeft); sw.set(b.offsetWidth); } };
}
const knobDir = segKnob($("#segDir"));
let knobMode = () => {};

function renderHeader() {
  const src = DATA.source === "sample" ? "Beispiel · öffentliches GitHub-Repository" : DATA.source === "local" ? "Lokaler Ordner" : "GitHub";
  $("#repoName").textContent = DATA.repo;
  $("#envTxt").textContent = DATA.branch || "lokal";
  $("#srcLabel").textContent = src;
  const h = $("#repoTitle"); h.textContent = "";
  h.append(DATA.source === "local" ? DATA.repo : el("a", { href: "https://github.com/" + DATA.repo, target: "_blank", rel: "noopener" }, DATA.repo));
  if (DATA.source === "sample") h.append(el("span", { class: "tag-example" }, "Beispiel"));
  $("#repoDesc").textContent = DATA.description || firstSentence(DATA.readme) || "";
  const k = $("#kpis"); k.textContent = "";
  const kpi = (v, l, cls) => el("div", { class: "kpi " + (cls || "") }, el("b", {}, v), el("span", {}, l));
  k.append(kpi(fmtInt(A.files.length), "Dateien"), kpi(fmtInt(A.nodes.length), "Komponenten"), kpi(fmtInt(A.resolved), "Importe", "opt"), kpi(fmtBytes(A.total), "Größe", "opt"), kpi(A.score, "Score"));
  $("#bArch").textContent = A.nodes.length; $("#bFiles").textContent = fmtInt(A.files.length); $("#bScore").textContent = A.score;
}

/* ============ Arbeitsfläche: Layout, Karten, Kanten ============ */
const CARD_W = 232, CARD_H = 94;
const view = { s: spring(1, { eps: 0.0005 }), x: spring(0, { eps: 0.2 }), y: spring(0, { eps: 0.2 }) };
let viewRaf = 0;
const applyView = () => { if (viewRaf) return; viewRaf = requestAnimationFrame(() => { viewRaf = 0; $("#canvas").style.transform = `translate(${view.x.value}px,${view.y.value}px) scale(${view.s.value})`; }); };
view.s.onUpdate = view.x.onUpdate = view.y.onUpdate = applyView;
let graphSize = { w: 0, h: 0 };

function renderLegend(ast) {
  const lg = $("#legend"); lg.textContent = "";
  const used = new Set(ast.nodes.map(n => n.cat));
  for (const c of CAT_ORDER) if (used.has(c)) lg.append(el("span", { style: `--c:var(--c-${c})` }, el("i"), CATS[c].label));
}
function catIcon(cat) { return svgUse("k-" + cat); }

function renderCanvas({ animate = true } = {}) {
  if (!A) return;
  const ast = currentAst();
  renderLegend(ast);
  const ov = $("#overview");
  if (MODE === "ai" && AI) { ov.hidden = false; ov.textContent = ""; ov.append(el("div", { class: "who" }, AI.who || "Überblick"), el("p", {}, AI.overview || "")); }
  else if (A.analysed === 0) { ov.hidden = false; ov.textContent = ""; ov.append(el("p", { class: "muted" }, "Für dieses Repository wurde kein Quellcode gelesen. Das Diagramm zeigt daher nur die Ordnerstruktur ohne Verbindungen.")); }
  else ov.hidden = true;
  const nodesEl = $("#nodes"), svg = $("#edges"), empty = $("#stageEmpty");
  nodesEl.textContent = ""; svg.textContent = "";
  if (typeof dagre === "undefined") { empty.hidden = false; empty.textContent = "Die Layout-Bibliothek konnte nicht geladen werden. Prüfe die Verbindung und lade die Seite neu."; return; }
  empty.hidden = true;

  /* Layout: verbundene Komponenten mit dagre (Gruppen als Cluster), unverbundene kompakt als Raster darunter */
  const linkedIds = new Set(ast.edges.flatMap(e => [e.from, e.to]));
  const linked = ast.nodes.filter(n => linkedIds.has(n.id)), loose = ast.nodes.filter(n => !linkedIds.has(n.id));
  const g = new dagre.graphlib.Graph({ compound: true });
  g.setGraph({ rankdir: DIR === "TD" ? "TB" : "LR", nodesep: 34, ranksep: DIR === "TD" ? 78 : 96, marginx: 70, marginy: 70 });
  g.setDefaultEdgeLabel(() => ({}));
  const groups = new Map();
  const groupOf = n => n.group || CATS[n.cat].label;
  for (const n of linked) { const gl = groupOf(n); if (!groups.has(gl)) groups.set(gl, { id: "grp" + groups.size, label: gl, members: [] }); groups.get(gl).members.push(n.id); }
  groups.forEach(gr => g.setNode(gr.id, {}));
  for (const n of linked) { g.setNode(n.id, { width: CARD_W, height: CARD_H }); g.setParent(n.id, groups.get(groupOf(n)).id); }
  for (const e of ast.edges) g.setEdge(e.from, e.to, { w: e.w, label: e.label });
  if (linked.length) { try { dagre.layout(g); } catch (err) { console.error(err); empty.hidden = false; empty.textContent = "Das Layout ließ sich nicht berechnen."; return; } }
  let W = linked.length ? Math.ceil(g.graph().width) : 0, H = linked.length ? Math.ceil(g.graph().height) : 0;
  const pos = new Map(linked.map(n => [n.id, g.node(n.id)]));
  if (loose.length) {
    const cols = Math.max(2, Math.min(6, Math.floor(((W || 1200) - 140) / (CARD_W + 24))));
    const sorted = [...loose].sort((a, b) => CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b.cat));
    const y0 = (H ? H - 20 : 70) + 36 + CARD_H / 2, x0 = 70 + CARD_W / 2;
    sorted.forEach((n, i) => pos.set(n.id, { x: x0 + (i % cols) * (CARD_W + 24), y: y0 + Math.floor(i / cols) * (CARD_H + 22) }));
    groups.set("__loose", { id: "grpLoose", label: linked.length ? "Ohne Import-Verbindungen" : "Komponenten", members: sorted.map(n => n.id) });
    const rows = Math.ceil(sorted.length / cols);
    W = Math.max(W, 70 * 2 + cols * (CARD_W + 24) - 24); H = y0 + (rows - 1) * (CARD_H + 22) + CARD_H / 2 + 70;
  }
  graphSize = { w: W, h: H };
  svg.setAttribute("width", W); svg.setAttribute("height", H); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  /* Gruppenrahmen aus den Mitgliedern berechnen */
  groups.forEach(gr => {
    const ps = gr.members.map(id => pos.get(id));
    const gx0 = Math.min(...ps.map(p => p.x - CARD_W / 2)) - 16, gx1 = Math.max(...ps.map(p => p.x + CARD_W / 2)) + 16;
    const gy0 = Math.min(...ps.map(p => p.y - CARD_H / 2)) - 36, gy1 = Math.max(...ps.map(p => p.y + CARD_H / 2)) + 16;
    gr.el = el("div", { class: "grp", style: `left:${gx0}px;top:${gy0}px;width:${gx1 - gx0}px;height:${gy1 - gy0}px` }, el("span", {}, gr.label));
    nodesEl.append(gr.el);
  });

  /* Kanten */
  const NS = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(NS, "defs");
  for (const [id, col] of [["arr", "var(--edge)"], ["arrHot", "var(--edge-hot)"]]) {
    const m = document.createElementNS(NS, "marker");
    Object.entries({ id, viewBox: "0 0 10 10", refX: "8.5", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" }).forEach(([k, v]) => m.setAttribute(k, v));
    const p = document.createElementNS(NS, "path"); p.setAttribute("d", "M1 1.5L8.5 5 1 8.5"); p.setAttribute("fill", "none"); p.setAttribute("stroke", col); p.setAttribute("stroke-width", "1.6"); p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round");
    m.append(p); defs.append(m);
  }
  svg.append(defs);
  const line = d3.line().x(p => p.x).y(p => p.y).curve(d3.curveBasis);
  const maxW = Math.max(1, ...ast.edges.map(e => e.w || 1));
  EDGE_ELS = [];
  ast.edges.forEach((e, i) => {
    const ed = g.edge(e.from, e.to); if (!ed) return;
    const d = line(ed.points);
    const sw = e.w ? 1.2 + Math.min(2.4, Math.log2(e.w + 1) * 0.55) : 1.5;
    const base = document.createElementNS(NS, "path"); base.setAttribute("d", d); base.setAttribute("class", "edge"); base.setAttribute("stroke-width", sw); base.setAttribute("marker-end", "url(#arr)");
    const flow = document.createElementNS(NS, "path"); flow.setAttribute("d", d); flow.setAttribute("class", "flow"); flow.setAttribute("stroke-width", Math.max(1.4, sw * 0.8));
    if (e.w) flow.style.animationDuration = (1.6 - Math.min(0.9, (e.w / maxW) * 0.9)).toFixed(2) + "s"; /* stärkere Kopplung fließt schneller */
    svg.append(base, flow);
    let label = null;
    if (e.label) { const mid = ed.points[Math.floor(ed.points.length / 2)]; label = el("div", { class: "elabel", style: `left:${mid.x}px;top:${mid.y}px` }, e.label); nodesEl.append(label); }
    EDGE_ELS.push({ e, base, flow, label });
    if (animate && !REDUCE.matches) {
      const len = base.getTotalLength();
      base.animate([{ strokeDasharray: `${len} ${len}`, strokeDashoffset: len }, { strokeDasharray: `${len} ${len}`, strokeDashoffset: 0 }], { duration: 700, delay: 260 + i * 14, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" });
      flow.animate([{ opacity: 0 }, { opacity: 0.35 }], { duration: 400, delay: 800 + i * 14, fill: "backwards" });
      label?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 700 + i * 14, fill: "backwards" });
    }
  });

  /* Karten – gestaffelt nach Rang einblenden */
  CARD_ELS = new Map();
  const order = [...ast.nodes].sort((a, b) => (DIR === "TD" ? pos.get(a.id).y - pos.get(b.id).y || pos.get(a.id).x - pos.get(b.id).x : pos.get(a.id).x - pos.get(b.id).x || pos.get(a.id).y - pos.get(b.id).y));
  order.forEach((n, i) => {
    const p = pos.get(n.id);
    const foot = n.files !== undefined || MODE === "heur"
      ? [el("span", { class: "dot" }), el("span", {}, `${fmtInt(heurNode(n.id)?.files.length ?? 0)} Dateien`), el("span", { class: "sz" }, fmtBytes(heurNode(n.id)?.bytes ?? 0))]
      : [el("span", { class: "dot" }), el("span", {}, CATS[n.cat].label)];
    const card = el("div", { class: "card" + (MODE === "ai" && !n.path ? " ext" : ""), tabindex: "0", role: "button", "aria-label": n.label, "data-id": n.id,
      style: `--c:var(--c-${n.cat});left:${p.x - CARD_W / 2}px;top:${p.y - CARD_H / 2}px` },
      el("div", { class: "hd" }, el("span", { class: "ico" }, catIcon(n.cat)), el("div", { style: "min-width:0" }, el("div", { class: "nm" }, n.label), el("div", { class: "pth" }, MODE === "ai" ? (n.path || "externer Dienst") : (n.path || "/")))),
      el("div", { class: "ft" }, ...(MODE === "ai" ? aiFoot(n) : foot)));
    card.addEventListener("click", ev => { ev.stopPropagation(); select(n.id); centerOn(n.id); });
    card.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(n.id); } });
    card.addEventListener("pointerdown", ev => ev.stopPropagation());
    nodesEl.append(card); CARD_ELS.set(n.id, card);
    if (animate && !REDUCE.matches) card.animate([{ opacity: 0, transform: "translateY(10px) scale(.97)" }, { opacity: 1, transform: "none" }], { duration: 520, delay: Math.min(500, i * 28), easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" });
  });
  groups.forEach(gr => { gr.el._members = gr.members; });
  GROUP_ELS = [...groups.values()];
  if (animate && !REDUCE.matches) GROUP_ELS.forEach((gr, i) => gr.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: i * 40, fill: "backwards" }));

  fitView(false);
  if (SELECTED && CARD_ELS.has(SELECTED)) highlight(SELECTED); else if (SELECTED) select(null);
}
let EDGE_ELS = [], CARD_ELS = new Map(), GROUP_ELS = [];
const heurNode = id => A.nodes.find(n => n.id === id);
function aiFoot(n) {
  const files = n.path ? A.files.filter(f => f.path === n.path || f.path.startsWith(n.path + "/")) : [];
  return files.length ? [el("span", { class: "dot" }), el("span", {}, `${fmtInt(files.length)} Dateien`), el("span", { class: "sz" }, fmtBytes(files.reduce((a, f) => a + f.size, 0)))]
    : [el("span", { class: "dot" }), el("span", {}, n.path ? "Datei" : "extern")];
}

function highlight(id) {
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

/* ============ Pan & Zoom – 1:1 ziehen, Schwung, Scrollen verschiebt, ⌘/Strg + Scrollen zoomt ============ */
function fitTarget() {
  const st = $("#stage"); if (!graphSize.w) return null;
  const sw = st.clientWidth, sh = st.clientHeight;
  const top = Math.min(sh * 0.35, ($(".hud")?.offsetHeight || 0) + 24);
  const s = Math.min(1.05, Math.max(sw < 700 ? 0.42 : 0.5, Math.min((sw - 40) / graphSize.w, (sh - top - 50) / graphSize.h)));
  return { s, x: (sw - graphSize.w * s) / 2, y: top + Math.max(0, (sh - top - 50 - graphSize.h * s) / 2) };
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
    view.x.stop(); view.y.stop(); view.s.stop(); /* greift die Fläche mitten im Gleiten */
    drag = { x: e.clientX, y: e.clientY, vx: view.x.value, vy: view.y.value, moved: false, hist: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }] };
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
    if (!d.moved) { if (e.target.closest(".stage") && !e.target.closest(".card")) select(null); return; }
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

/* ============ Detail-Panel – federt von rechts ein, mit Schwung wegziehbar ============ */
const panelX = spring(1, { eps: 0.002, response: 0.42 }); /* 0 = offen, 1 = geschlossen (Anteil der Breite) */
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
    if (off < 0) off = rubber(off, W); /* weicher Widerstand nach links */
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
  if (e.key === "Escape") { if ($("#tokenPop").dataset.open === "true") toggleToken(false); else if (SELECTED) select(null); }
  if (e.key === "/" && document.activeElement?.tagName !== "INPUT") { e.preventDefault(); $("#repoInput").focus(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#repoInput").focus(); $("#repoInput").select(); }
});

function select(id) {
  SELECTED = id; highlight(id);
  if (!id) { closePanel(); return; }
  const ast = currentAst();
  const an = ast.nodes.find(n => n.id === id); if (!an) return;
  const head = $("#panelHead"), body = $("#panelBody"); head.textContent = ""; body.textContent = "";
  panelEl.style.setProperty("--c", `var(--c-${an.cat})`);
  head.append(el("span", { class: "ico" }, catIcon(an.cat)),
    el("div", { class: "t" }, el("h2", {}, an.label), el("span", { class: "pill" }, el("i"), CATS[an.cat].label)),
    el("button", { class: "close", type: "button", "aria-label": "Schließen", onclick: () => select(null) }, svgUse("i-x")));

  const files = MODE === "heur" ? (heurNode(id)?.files || []) : (an.path ? A.files.filter(f => f.path === an.path || f.path.startsWith(an.path.replace(/\/$/, "") + "/")) : []);
  if (an.desc) body.append(el("p", { class: "desc" }, an.desc));
  /* Kennzahlen */
  if (files.length) {
    const bytes = files.reduce((a, f) => a + f.size, 0);
    body.append(el("div", { class: "tiles" },
      el("div", { class: "tile" }, el("b", {}, fmtInt(files.length)), el("span", {}, "Dateien")),
      el("div", { class: "tile" }, el("b", {}, fmtBytes(bytes)), el("span", {}, "Größe")),
      el("div", { class: "tile" }, el("b", {}, fmtInt(files.filter(f => isTest(f.path)).length)), el("span", {}, "Tests"))));
  }
  /* Pfad */
  const isDir = an.path ? !A.fileSet.has(an.path) : false;
  const u = an.path ? repoUrl(an.path, isDir) : null;
  body.append(el("div", { class: "sec" }, el("h4", {}, "Pfad"),
    el("div", { class: "pathbox" }, svgUse(isDir || !an.path ? "i-folder" : "i-file"),
      u ? el("a", { href: u, target: "_blank", rel: "noopener", style: "flex:1" }, an.path) : el("span", { style: "flex:1" }, an.path || (MODE === "ai" ? "Externer Dienst – kein Pfad im Repo" : "/ (Wurzel)")),
      u ? svgUse("i-ext") : null)));
  /* Sprachen */
  if (files.length) {
    const bytes = files.reduce((a, f) => a + f.size, 0);
    const lang = new Map(); files.forEach(f => { const [n, c] = langOf(f.path); const o = lang.get(n) || { n, c, b: 0 }; o.b += f.size; lang.set(n, o); });
    const ls = [...lang.values()].sort((a, b) => b.b - a.b);
    const bar = el("div", { class: "minibar" }, ...ls.map(l => el("i", { style: `width:${(l.b / bytes * 100).toFixed(2)}%;background:${l.c}` })));
    body.append(el("div", { class: "sec" }, el("h4", {}, "Sprachen"), bar,
      el("div", { class: "rows" }, ...ls.slice(0, 4).map(l => el("div", { class: "r" }, el("span", { class: "d", style: `background:${l.c}` }), el("span", { class: "n" }, l.n), el("span", { class: "v" }, (l.b / bytes * 100).toFixed(0) + " %"))))));
  }
  /* Verbindungen */
  const outE = ast.edges.filter(e => e.from === id), inE = ast.edges.filter(e => e.to === id);
  const conn = (title, arr, key) => {
    if (!arr.length) return null;
    return el("div", { class: "sec" }, el("h4", {}, title), el("div", { class: "rows" }, ...arr.map(e => {
      const o = ast.nodes.find(n => n.id === e[key]); if (!o) return null;
      return el("button", { class: "r", type: "button", onclick: () => { select(o.id); centerOn(o.id); } },
        el("span", { class: "d", style: `background:var(--c-${o.cat})` }), el("span", { class: "n" }, o.label), el("span", { class: "v" }, e.label || ""), el("span", { class: "ar" }, "→"));
    })));
  };
  const c1 = conn(MODE === "heur" ? "Importiert aus" : "Verbindet zu", outE, "to"), c2 = conn(MODE === "heur" ? "Wird importiert von" : "Verbunden von", inE, "from");
  if (c1) body.append(c1); if (c2) body.append(c2);
  if (!c1 && !c2) body.append(el("p", { class: "empty-note" }, MODE === "heur" ? "Keine erkannten Importe zu anderen Komponenten." : "Keine Verbindungen."));
  /* Größte Dateien */
  if (files.length) {
    body.append(el("div", { class: "sec" }, el("h4", {}, "Größte Dateien"), el("div", { class: "rows" }, ...[...files].sort((a, b) => b.size - a.size).slice(0, 7).map(f => {
      const fu = repoUrl(f.path, false); const short = an.path && f.path.startsWith(an.path + "/") ? f.path.slice(an.path.length + 1) : f.path;
      return el("div", { class: "r f" }, el("span", { class: "d", style: `background:${langOf(f.path)[1]}` }), fu ? el("a", { class: "n", href: fu, target: "_blank", rel: "noopener", title: f.path }, short) : el("span", { class: "n", title: f.path }, short), el("span", { class: "v" }, fmtBytes(f.size)));
    }))));
  }
  openPanel();
}
/* Karte sanft in die Mitte holen (Platz für das Panel lassen) */
function centerOn(id) {
  const c = CARD_ELS.get(id); if (!c) return;
  const st = $("#stage"), s = Math.max(view.s.target, 0.8);
  view.s.to(s);
  const cx = parseFloat(c.style.left) + CARD_W / 2, cy = parseFloat(c.style.top) + CARD_H / 2;
  const free = st.clientWidth - (st.clientWidth > 760 ? panelEl.offsetWidth + 20 : 0);
  view.x.to(free / 2 - cx * s); view.y.to(st.clientHeight / 2 - cy * s);
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
    const info = `${d.data.aggregate ? d.data.path + "/… (tiefere Ebenen)" : d.data.path}\n${fmtBytes(d.value)}${isDir ? " · " + d.leaves().length + " Einträge" : ""}`;
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
/* Hineinzoomen: der angeklickte Ordner wächst aus seiner Position auf die volle Fläche */
function zoomTreemap(path, d) {
  const box = $("#tm");
  if (d && !REDUCE.matches) {
    const W = box.clientWidth, H = box.clientHeight;
    const sx = (d.x1 - d.x0) / W, sy = (d.y1 - d.y0) / H;
    tmRoot = path; renderTreemap();
    box.animate([{ transformOrigin: "0 0", transform: `translate(${d.x0}px,${d.y0}px) scale(${sx},${sy})`, opacity: .6 }, { transformOrigin: "0 0", transform: "none", opacity: 1 }], { duration: 480, easing: "cubic-bezier(.16,1,.3,1)" });
  } else { tmRoot = path; renderTreemap(); }
}

/* ============ Dateibaum ============ */
let openDirs = new Set();
function renderFiles() {
  const q = $("#fileSearch").value.trim().toLowerCase();
  const box = $("#files"); box.textContent = "";
  if (!A) return;
  const match = A.files.filter(f => !q || f.path.toLowerCase().includes(q));
  $("#fileCount").textContent = `${fmtInt(match.length)} von ${fmtInt(A.files.length)} Dateien`;
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
  if (rows > LIMIT) box.append(el("div", { class: "r muted" }, "Liste gekürzt – Filter verwenden."));
}
$("#fileSearch").addEventListener("input", renderFiles);

/* ============ Screening-Dashboard ============ */
function renderHealth() {
  const g = $("#healthGrid"); g.textContent = ""; if (!A) return;
  const C = 2 * Math.PI * 38;
  const bad = A.checks.filter(c => c.s === "bad").length, warn = A.checks.filter(c => c.s === "warn").length, ok = A.checks.filter(c => c.s === "ok").length;
  const ring = el("svg", {}); ring.outerHTML; /* Platzhalter */
  const ringWrap = document.createElement("div");
  ringWrap.innerHTML = `<svg class="ring" viewBox="0 0 92 92" aria-hidden="true"><circle class="bg" cx="46" cy="46" r="38"/><circle class="fg" cx="46" cy="46" r="38" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - A.score / 100)).toFixed(2)}" transform="rotate(-90 46 46)"/></svg>`;
  const fg = ringWrap.querySelector(".fg");
  if (!REDUCE.matches) fg.animate([{ strokeDashoffset: C }, { strokeDashoffset: C * (1 - A.score / 100) }], { duration: 1100, easing: "cubic-bezier(.16,1,.3,1)" });
  const cnt = (n, l, v) => n ? el("span", { style: `color:var(--${v});background:color-mix(in srgb,var(--${v}) 14%,transparent)` }, `${n} ${l}`) : null;
  const scoreNum = el("span", {}, "0");
  g.append(el("div", { class: "box span5" }, el("h3", {}, "Projektgesundheit", el("small", {}, "10 Prüfungen")),
    el("div", { class: "scorebox" }, ringWrap.firstElementChild,
      el("div", {}, el("div", { class: "big" }, scoreNum, el("small", {}, " / 100")),
        el("p", {}, bad ? "Es gibt kritische Punkte, die du dir ansehen solltest." : warn ? "Solide Basis mit einzelnen Hinweisen." : "Alle Prüfungen bestanden."),
        el("div", { class: "counts" }, cnt(ok, "bestanden", "ok"), cnt(warn, "Hinweis" + (warn > 1 ? "e" : ""), "warn"), cnt(bad, "kritisch", "bad"))))));
  countUp(scoreNum, A.score);

  const lw = el("div", { class: "box span7", style: "animation-delay:.05s" }, el("h3", {}, "Sprachen", el("small", {}, "nach Dateigröße")));
  lw.append(el("div", { class: "langbar" }, ...A.langs.map((l, i) => el("i", { style: `width:${(l.bytes / A.total * 100).toFixed(3)}%;background:${l.color};animation-delay:${i * 40}ms`, title: l.name }))));
  lw.append(el("div", { class: "rows", style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:0 18px" }, ...A.langs.slice(0, 10).map(l =>
    el("div", { class: "r" }, el("span", { class: "d", style: `background:${l.color}` }), el("span", { class: "n" }, l.name), el("span", { class: "v" }, (l.bytes / A.total * 100).toFixed(1) + " %")))));
  g.append(lw);

  g.append(el("div", { class: "box span12", style: "animation-delay:.1s" }, el("h3", {}, "Prüfungen"),
    el("ul", { class: "checks" }, ...A.checks.map(c => el("li", { class: c.s }, el("span", { class: "st" }, c.s === "ok" ? "✓" : c.s === "warn" ? "!" : c.s === "bad" ? "✕" : "–"), el("b", {}, c.t), el("span", { class: "why" }, c.w))))));

  g.append(el("div", { class: "box span4", style: "animation-delay:.15s" }, el("h3", {}, "Stack", el("small", {}, A.stack.length + " erkannt")),
    A.stack.length ? el("div", { class: "chips" }, ...A.stack.map(s => el("span", { class: "chip" }, s))) : el("p", { class: "empty-note" }, "Kein bekannter Stack erkannt.")));

  const ast = heuristicAst(A); const deg = new Map(); ast.edges.forEach(e => deg.set(e.to, (deg.get(e.to) || 0) + (e.w || 1)));
  const hubs = [...deg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  g.append(el("div", { class: "box span4", style: "animation-delay:.2s" }, el("h3", {}, "Meistgenutzt", el("small", {}, "eingehende Importe")),
    hubs.length ? el("div", { class: "rows" }, ...hubs.map(([id, w]) => { const n = ast.nodes.find(x => x.id === id);
      return el("button", { class: "r", type: "button", onclick: () => { switchTab("arch"); setTimeout(() => { select(id); centerOn(id); }, 60); } },
        el("span", { class: "d", style: `background:var(--c-${n.cat})` }), el("span", { class: "n" }, n.label), el("span", { class: "v" }, fmtInt(w)), el("span", { class: "ar" }, "→")); }))
      : el("p", { class: "empty-note" }, "Keine Importe ausgewertet.")));

  g.append(el("div", { class: "box span4", style: "animation-delay:.25s" }, el("h3", {}, "Größte Dateien", el("small", {}, "Hotspots")),
    el("div", { class: "rows" }, ...[...A.files].sort((a, b) => b.size - a.size).slice(0, 8).map(f => { const u = repoUrl(f.path, false);
      return el("div", { class: "r f" }, el("span", { class: "d", style: `background:${langOf(f.path)[1]}` }), u ? el("a", { class: "n", href: u, target: "_blank", rel: "noopener", title: f.path }, f.path) : el("span", { class: "n", title: f.path }, f.path), el("span", { class: "v" }, fmtBytes(f.size))); }))));

  const notes = [];
  if (DATA.truncated) notes.push("GitHub hat den Dateibaum gekürzt geliefert. Sehr große Repos sind deshalb unvollständig.");
  if (DATA.source === "github" && A.analysed) notes.push(`Importe stammen aus einer Stichprobe von ${A.analysed} gelesenen Quelldateien.`);
  if (DATA.source === "sample") notes.push("Beispieldaten: Dateibaum und Importe von ahmedkhaleel2004/gitdiagram, erfasst am 2. November 2026.");
  if (notes.length) g.append(el("div", { class: "box span12", style: "animation-delay:.3s" }, el("h3", {}, "Hinweise"), ...notes.map(t => el("div", { class: "notice" }, t))));
}
function countUp(node, to) {
  if (REDUCE.matches) { node.textContent = to; return; }
  const t0 = performance.now(), D = 1000;
  const f = now => { const p = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - p, 4); node.textContent = Math.round(to * e); if (p < 1) requestAnimationFrame(f); };
  requestAnimationFrame(f);
}

/* ============ Tabs & Steuerung ============ */
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
const setDir = d => { DIR = d; $("#dirTD").setAttribute("aria-pressed", d === "TD"); $("#dirLR").setAttribute("aria-pressed", d === "LR"); knobDir(); renderCanvas(); };
$("#dirTD").onclick = () => setDir("TD"); $("#dirLR").onclick = () => setDir("LR");
$("#copyMm").onclick = async () => {
  const b = $("#copyMm"), src = compileMermaid(currentAst(), DIR);
  const done = ok => { b.title = ok ? "Kopiert" : "Kopieren nicht möglich"; b.animate([{ transform: "scale(.9)" }, { transform: "scale(1.08)" }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(.16,1,.3,1)" }); toast(ok ? "Mermaid-Quelltext kopiert" : "Kopieren nicht möglich"); };
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

/* ============ Analyse-Protokoll (Build-Log) & Toasts ============ */
let logHide = 0;
function logStart(title = "Analyse läuft") {
  clearTimeout(logHide);
  const l = $("#log"); l.dataset.open = "true"; $("#logBody").textContent = ""; $("#logTitle").textContent = title; $("#logSt").className = "st";
}
function logStep(text, cls = "") { const r = el("div", { class: "row " + cls }, el("i", {}, cls === "err" ? "✕" : cls === "done" ? "✓" : "›"), el("span", {}, text)); $("#logBody").append(r); $("#logBody").scrollTop = 1e6; if (cls === "err") { $("#logSt").className = "st err"; $("#logTitle").textContent = "Analyse fehlgeschlagen"; } return r; }
function logDone(r, text) { r.className = "row done"; r.firstChild.textContent = "✓"; if (text) r.lastChild.textContent = text; }
function logFinish(text) { $("#logSt").className = "st ok"; $("#logTitle").textContent = text || "Analyse abgeschlossen"; logHide = setTimeout(() => { $("#log").dataset.open = "false"; }, 3800); }
$("#logClose").onclick = () => { $("#log").dataset.open = "false"; };
function toast(text) { logStart(text); $("#logBody").append(el("div", { class: "row done" }, el("i", {}, "✓"), el("span", {}, text))); logFinish(text); }

/* ============ Alles anzeigen ============ */
function show(data) {
  DATA = data; A = analyze(data); AI = null; SELECTED = null; tmRoot = ""; openDirs = new Set();
  MODE = "heur";
  panelX.set(1); panelEl.dataset.state = "closed";
  EXT.onShow.forEach(f => f());
  renderHeader();
  if (TAB !== "arch") switchTab("arch");
  requestAnimationFrame(() => { renderCanvas(); knobMode(false); knobDir(false); moveTabInd(false); });
}
$("#loadForm").addEventListener("submit", async e => {
  e.preventDefault();
  const v = $("#repoInput").value; if (!v.trim()) { $("#repoInput").focus(); return; }
  const b = $("#loadBtn"); b.disabled = true; b.classList.add("busy");
  try { const d = await loadGitHub(v); show(d); logFinish(`${d.repo} analysiert`); }
  catch (err) { if ($("#log").dataset.open !== "true") logStart(); logStep(err.message || String(err), "err"); }
  finally { b.disabled = false; b.classList.remove("busy"); }
});
$("#dirInput").addEventListener("change", async e => {
  try { const d = await loadLocal(e.target.files); show(d); logFinish(`»${d.repo}« analysiert`); } catch (err) { logStart(); logStep(err.message || String(err), "err"); }
  e.target.value = "";
});
$("#sampleBtn").onclick = () => { $("#log").dataset.open = "false"; show(SAMPLE); };

/* ============ Größe & Theme ============ */
let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { moveTabInd(false); knobMode(false); knobDir(false); if (TAB === "tree") renderTreemap(); if (TAB === "arch") fitView(true); }, 120); });
if (document.fonts?.ready) document.fonts.ready.then(() => { moveTabInd(false); knobMode(false); knobDir(false); });

/* ============ Start ============ */
const SAMPLE = (() => { try { const s = JSON.parse(document.getElementById("sample-data").textContent); s.source = "sample"; s.description = "Verwandelt ein GitHub-Repository in ein interaktives Architekturdiagramm."; return s; } catch { return null; } })();
const qp = new URLSearchParams(location.search).get("repo");
if (qp) { $("#repoInput").value = qp; $("#loadForm").requestSubmit(); }
else if (SAMPLE) show(SAMPLE);
