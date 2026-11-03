/* ============ Architecture guide: explanation without AI ============
   Everything here is derived from measured facts (components, imports, services) and from
   what the authors wrote themselves (README sections, architecture docs, comments, exports). */

function joinList(items, max = 4) {
  const x = items.filter(Boolean);
  if (x.length > max) return x.slice(0, max).join(", ") + ` and ${x.length - max} more`;
  return x.length <= 1 ? (x[0] || "") : x.slice(0, -1).join(", ") + " and " + x[x.length - 1];
}
const mdInline = s => s.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1").replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|[.,;:!?]|$)/g, "$1$2").trim();

/* Roughly split Markdown into paragraphs and list items (without code blocks, images, badges, HTML) */
function mdBlocks(md, maxChars = 900) {
  const clean = md.replace(/```[\s\S]*?```/g, "\n").replace(/<!--[\s\S]*?-->/g, "").replace(/^\s*(\[!\[|!\[|<img|<picture|<p align|<\/?(div|p|a|picture|source)\b).*$/gim, "");
  const out = []; let used = 0;
  for (const para of clean.split(/\n\s*\n/)) {
    const lines = para.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length || lines.every(l => /^(\||#|>?\s*$)/.test(l))) continue;
    if (lines.every(l => /^[-*+]\s|^\d+\.\s/.test(l))) lines.forEach(l => out.push({ t: "li", s: mdInline(l.replace(/^([-*+]|\d+\.)\s+/, "")) }));
    else out.push({ t: "p", s: mdInline(lines.filter(l => !/^#/.test(l)).join(" ")) });
    used = out.reduce((a, b) => a + b.s.length, 0);
    if (used > maxChars) break;
  }
  return out.filter(b => b.s.length > 14 || (b.t === "li" && b.s.length > 2)).filter(b => !/^[←→↑↓]/.test(b.s));
}
/* README sections that describe the architecture */
function archSections(md) {
  if (!md) return [];
  const RX = /(architect|how it'?s built|how it works|how .* works|structure|design|overview|tech(nology)? stack|^stack$|data ?flow|under the hood|components|internals|concepts)/i;
  const parts = md.split(/^(#{1,4})[ \t]+(.+)$/m), out = [];
  for (let i = 1; i < parts.length; i += 3) {
    const title = mdInline(parts[i + 1] || ""), body = parts[i + 2] || "";
    if (RX.test(title) && !/(install|setup|getting started|licen[cs]e|contribut|sponsor|run(ning)? locally)/i.test(title)) out.push({ title, body });
  }
  return out.slice(0, 3);
}
/* Relationships from the authors' Mermaid diagrams (flowchart/graph) */
function mermaidRelations(md) {
  const rels = [];
  for (const block of (md || "").matchAll(/```mermaid\s*([\s\S]*?)```/g)) {
    const src = block[1]; if (!/^\s*(graph|flowchart)\b/m.test(src)) continue;
    const label = new Map();
    for (const m of src.matchAll(/([A-Za-z_][\w-]*)\s*(?:\[\(|\(\[|\[\[|\(\(|\[\/|\[|\(|\{\{|\{|>)\s*"?([^\]\)\}"]+?)"?\s*(?:\)\]|\]\)|\]\]|\)\)|\/\]|\]|\)|\}\}|\})/g)) if (!label.has(m[1])) label.set(m[1], m[2].trim());
    const node = String.raw`([A-Za-z_][\w-]*)(?:\s*(?:\[\(|\(\[|\[\[|\(\(|\[|\(|\{)[^\]\)\}]*(?:\)\]|\]\)|\]\]|\)\)|\]|\)|\}))?`;
    const rx = new RegExp(node + String.raw`\s*(-\.+->|-{2,}>|={2,}>|-\.+-|-{3,}|<-+>)\s*(?:\|"?([^|"]+)"?\|)?\s*` + node, "g");
    for (const line of src.split("\n")) for (const m of line.matchAll(rx)) {
      rels.push({ a: label.get(m[1]) || m[1], b: label.get(m[4]) || m[4], label: (m[3] || "").trim(), dotted: /\./.test(m[2]) });
    }
  }
  return rels.slice(0, 16);
}

function explainArchitecture(A, DATA) {
  const nodes = A.nodes.filter(n => !n.side && (n.kind !== "comp" || n.files.length));
  const ids = new Set(nodes.map(n => n.id));
  const edges = A.edges.filter(e => ids.has(e.from) && ids.has(e.to));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const L = id => byId.get(id)?.label || id;
  const outs = id => edges.filter(e => e.from === id).sort((a, b) => (b.w || 0) - (a.w || 0));
  const ins = id => edges.filter(e => e.to === id).sort((a, b) => (b.w || 0) - (a.w || 0));
  const indeg = id => ins(id).reduce((a, e) => a + (e.w || 1), 0);
  const meta = DATA.meta || {};
  const user = nodes.find(n => n.kind === "user");
  const shell = user ? byId.get(outs(user.id)[0]?.to) : null;
  const exts = nodes.filter(n => n.kind === "ext");
  const comps = nodes.filter(n => n.kind === "comp");

  /* Kind of project */
  const FW = ["Next.js", "Angular", "Vue", "Svelte", "React", "NestJS", "Express", "Fastify", "Hono", "FastAPI", "Django"];
  const fw = FW.filter(f => A.stack.includes(f));
  if (fw.includes("Next.js")) fw.splice(fw.indexOf("React"), fw.includes("React") ? 1 : 0);
  const codeLangs = A.langs.filter(l => !/Assets|Markdown|MDX|JSON|YAML|TOML|Other|HTML|CSS|SCSS|Dockerfile|Shell/.test(l.name));
  const codeBytes = codeLangs.reduce((a, l) => a + l.bytes, 0) || 1;
  const lang = codeLangs[0];
  const isUi = !!user;
  const backendish = comps.some(n => n.cat === "backend" && !n.file && /server|api|backend|workers?|functions/i.test(n.path)) || fw.some(f => /NestJS|Express|Fastify|Hono|FastAPI|Django/.test(f));
  const kind = isUi && backendish ? "full-stack web app" : isUi ? "web app" : backendish ? "backend service" : "code project";
  const name = DATA.repo.split("/").pop();

  /* Verbs for running text ("authenticates with Clerk" instead of "authenticates Clerk") */
  const PHRASE = { "authenticates": "authenticates with", "stores data": "stores data in", "uploads": "uploads to", "reports": "reports to", "sends email": "sends email via", "charges": "charges via", "caches": "caches in", "syncs": "syncs with", "streams": "streams to", "uses model": "uses", "reads config": "reads config from", "prompts": "prompts" };
  const phrase = v => PHRASE[v] || v || "uses";
  /* Outgoing relationships as a phrase: "shows A, B and C, and calls D" */
  const describeOuts = (id, max = 5) => {
    const by = new Map(); outs(id).slice(0, 8).forEach(e => { const v = phrase(e.verb); if (!by.has(v)) by.set(v, []); by.get(v).push(L(e.to)); });
    const parts = [...by.entries()].map(([v, ls]) => `${v} ${joinList(ls, max)}`);
    if (!parts.length) return "";
    return parts.length === 1 ? parts[0] : parts.length === 2 ? parts.join(" and ") : parts.slice(0, -1).join(", ") + ", and " + parts[parts.length - 1];
  };

  /* ---------- Summary ---------- */
  const summary = [];
  const head = `${fw.length ? joinList(fw.slice(0, 2)) + " " : ""}${kind}`;
  summary.push(`${name} is ${/^[AEIOU]/i.test(head) ? "an" : "a"} ${head}${lang ? ` written mainly in ${lang.name} (${Math.round(lang.bytes / codeBytes * 100)}% of the code)` : ""}.`);
  if (shell) { const o = describeOuts(shell.id); summary.push(`Users enter through ${shell.label}${shell.main ? ` (${shell.main})` : ""}${o ? `, which ${o}` : ""}.`); }
  const domains = [...new Set(comps.filter(n => n.group && n.group !== CATS[n.cat]?.label).map(n => n.group))];
  const domainCount = d => comps.filter(n => n.group === d).length;
  if (domains.length) summary.push(`The code is organized around the feature area${domains.length > 1 ? "s" : ""} ${joinList(domains.sort((a, b) => domainCount(b) - domainCount(a)).map(d => `${d} (${domainCount(d)} components)`), 3)}.`);
  else { const big = [...comps].sort((a, b) => b.files.length - a.files.length).slice(0, 3); if (big.length) summary.push(`The largest components are ${joinList(big.map(n => `${n.label} (${n.files.length} files)`))}.`); }
  const hubs = comps.filter(n => n !== shell && n.cat !== "frontend").sort((a, b) => indeg(b.id) - indeg(a.id)).filter(n => indeg(n.id) > 0).slice(0, 3);
  if (hubs.length) summary.push(`Most other parts depend on ${joinList(hubs.map(n => n.label))}${hubs.length > 1 ? " – they are the backbone of the code" : ""}.`);
  if (exts.length) summary.push(`It talks to ${joinList(exts.map(x => `${x.label}${x.main && x.main !== x.label ? ` (${x.main.split(" ").map(w => w === w.toUpperCase() ? w : w.toLowerCase()).join(" ")})` : ""}`), 5)}.`);
  summary.push(`This view shows ${comps.length} components and ${edges.filter(e => !e.user).length} relationships, derived from ${fmtInt(A.resolved)} resolved imports in ${fmtInt(A.analysed)} files.`);

  /* ---------- Role of each component ---------- */
  const childDirs = n => [...new Set(n.files.map(f => f.path.slice(n.path.length + 1)).filter(p => p.includes("/")).map(p => p.split("/")[0]))];
  const human = s => s.replace(/[-_.]+/g, " ").replace(/\b\w/g, c => c.toUpperCase()).trim();
  const srcFiles = n => n.files.filter(f => isCode(f.path) && !isTest(f.path));
  const docOf = n => {
    const main = n.file ? n.path : srcFiles(n).find(f => basename(f.path) === n.main)?.path;
    if (main && meta[main]?.d) return { d: meta[main].d, file: main };
    /* for folders, only a file that speaks for the whole folder (index-like), never an arbitrary comment */
    const idx = srcFiles(n).find(f => /(^|\/)(index|mod|__init__|main)\.(m?[jt]sx?|py|rs)$/.test(f.path) && dirname(f.path) === n.path && meta[f.path]?.d);
    return idx ? { d: meta[idx.path].d, file: idx.path } : null;
  };
  const exportsOf = n => { const main = n.file ? n.path : srcFiles(n).find(f => basename(f.path) === n.main)?.path; return (main && meta[main]?.x) || []; };
  const extUsers = id => ins(id).map(e => L(e.from));
  const domainName = n => n.group && n.group !== CATS[n.cat]?.label ? n.group : human(basename(dirname(n.path)) || basename(n.path) || name);
  const roleOf = n => {
    if (n.kind === "user") return "The person using the app – every interaction starts here.";
    if (n.kind === "ext") {
      const by = extUsers(n.id), who = by.length ? ` ${joinList(by)} ${by.length > 1 ? "call" : "calls"} it directly.` : "";
      if (/^API · /.test(n.label)) return `The backend API at ${n.label.slice(6)}, configured in the environment files.${who}`;
      return `${n.label} – an external ${(n.main || "service").toLowerCase()} service, detected from package imports.${who}`;
    }
    if (n === shell) return `Entry point of the app (${n.main || n.path}). It bootstraps the UI${describeOuts(n.id) ? " and " + describeOuts(n.id) : ""}.`;
    const users = ins(n.id).filter(e => !e.user).map(e => L(e.from));
    const usedBy = users.length ? ` Used by ${joinList(users)}.` : "";
    const ext = outs(n.id).filter(e => byId.get(e.to)?.kind === "ext").map(e => L(e.to));
    const talks = ext.length ? ` Talks to ${joinList(ext)}.` : "";
    if (n.file) {
      const importers = new Set(A.fileEdges.filter(([, to]) => to === n.path).map(([from]) => from));
      const compsUsing = new Set([...importers].map(f => A.fileComp.get(f)));
      const kindWord = (n.label.match(/(Service|Store|Model|API|Client|Repository|Context|Provider|Gateway|Facade|State)$/) || [, "module"])[1].toLowerCase();
      return `A central ${kindWord} inside ${n.parentLabel || "its folder"}: ${importers.size} file${importers.size === 1 ? "" : "s"} from ${compsUsing.size} component${compsUsing.size === 1 ? "" : "s"} import it.${talks}`;
    }
    const kids = childDirs(n).map(human);
    const p = n.path.toLowerCase();
    if (/environ|config|settings/.test(p)) return `Configuration such as API URLs and keys.${users.length ? ` Read by ${joinList(users)}.` : ""}`;
    if (/models?$|types?$|entities$|schema/.test(p)) return `Data types and models for ${domainName(n)}.${usedBy}`;
    if (n.cat === "frontend") return `${/components|views|pages|screens|widgets/.test(basename(p)) ? "UI building blocks" : "User-facing part"} for ${domainName(n)}${kids.length ? `: ${joinList(kids, 5)}` : ""}.${usedBy}${talks}`;
    if (n.cat === "backend") return `Services and logic for ${domainName(n)}${kids.length ? ` (${joinList(kids, 4)})` : ""}.${talks}${usedBy}`;
    if (n.cat === "core") return `Shared code${/shared|common|lib|utils?|helpers/.test(basename(p)) ? " and helpers" : ""} for ${domainName(n)}${kids.length ? ` (${joinList(kids, 4)})` : ""}.${usedBy}`;
    if (n.cat === "infra") return `Infrastructure and deployment code${kids.length ? ` (${joinList(kids, 4)})` : ""}.${usedBy}`;
    return `${CATS[n.cat]?.label || "Component"}.${usedBy}`;
  };
  const nodeInfo = new Map(nodes.map(n => [n.id, { role: roleOf(n), doc: n.kind === "comp" ? docOf(n) : null, exports: n.kind === "comp" ? exportsOf(n) : [] }]));

  /* ---------- Data flows: strongest path from the user to each external service ---------- */
  const roots = user ? [user.id] : comps.filter(n => !ins(n.id).length && outs(n.id).length).sort((a, b) => outs(b.id).length - outs(a.id).length).slice(0, 2).map(n => n.id);
  const bestPath = (target, from) => {
    let best = null, budget = 25000;
    const dfs = (id, path, score) => {
      if (--budget < 0 || path.length > 8) return;
      if (id === target) { if (!best || score > best.score || (score === best.score && path.length < best.path.length)) best = { path: [...path], score }; return; }
      for (const e of outs(id)) if (!path.includes(e.to)) { path.push(e.to); dfs(e.to, path, score + Math.log2((e.w || 1) + 1)); path.pop(); }
    };
    dfs(from, [from], 0); return best?.path || null;
  };
  const narrate = path => path.map((id, i) => i === 0 ? L(id) : `${i === 1 ? "" : "which "}${phrase(edges.find(e => e.from === path[i - 1] && e.to === id)?.verb)} ${L(id)}`).reduce((a, s, i) => i === 0 ? s : i === 1 ? `${a} ${s}` : `${a}, ${s}`, "") + ".";
  const flows = [];
  for (const x of exts.slice(0, 4)) for (const r of roots) { const p = bestPath(x.id, r); if (p) { flows.push({ title: `${L(r)} → ${x.label}`, path: p, text: narrate(p) }); break; } }
  /* Main path inward: from the entry point, always follow the strongest edge */
  if (roots.length) {
    const p = [roots[0]]; let cur = roots[0];
    for (let i = 0; i < 8; i++) { const e = outs(cur).find(e => !p.includes(e.to) && byId.get(e.to)?.kind !== "ext"); if (!e) break; p.push(e.to); cur = e.to; }
    if (p.length > 2 && !flows.some(f => f.path.join() === p.join())) flows.unshift({ title: "Main path through the code", path: p, text: narrate(p) });
  }

  /* ---------- Layers ---------- */
  const layerOf = n => n.kind === "user" ? null : n.kind === "ext" ? "ext" : n.cat === "frontend" ? "ui" : (n.cat === "backend" || (n.file && /(Service|Store|API|Client|Repository|State|Gateway|Facade)$/.test(n.label))) ? "logic" : (n.cat === "core" || n.cat === "config") ? "core" : "other";
  const LAYERS = [
    { k: "ui", title: isUi ? "User interface" : "Entry points", desc: isUi ? "Screens and components the user sees and interacts with." : "Where requests or commands enter the code." },
    { k: "logic", title: "Logic & services", desc: "State, business rules and the calls to the outside world." },
    { k: "core", title: "Core & data", desc: "Models, shared helpers and configuration used across the code." },
    { k: "ext", title: "External services", desc: "Third-party services and APIs the code depends on at runtime." },
    { k: "other", title: "Other", desc: "Remaining components." },
  ];
  const layers = LAYERS.map(l => ({ ...l, nodes: nodes.filter(n => layerOf(n) === l.k).sort((a, b) => indeg(b.id) - indeg(a.id)).map(n => n.id) })).filter(l => l.nodes.length);

  /* ---------- Reading order ---------- */
  const start = [];
  const addStart = (n, why) => { if (!n || start.some(s => s.id === n.id)) return; const path = n.file ? n.path : srcFiles(n).find(f => basename(f.path) === n.main)?.path; if (path) start.push({ id: n.id, path, why }); };
  if (shell) addStart(shell, "Where the app starts and decides what to show.");
  const kindOf = n => /^use[A-Z]/.test(n.label) ? "hook" : ((n.label.match(/(Service|Store|Model|API|Client|Repository|Context|Provider|Gateway|Facade|State)$/) || [, "module"])[1]).replace(/^(?!API)\w+/, w => w.toLowerCase());
  comps.filter(n => n.file).sort((a, b) => indeg(b.id) - indeg(a.id)).slice(0, 3).forEach(n => addStart(n, `Central ${kindOf(n)} – ${ins(n.id).length || "several"} component${ins(n.id).length === 1 ? " depends" : "s depend"} on it.`));
  addStart(comps.find(n => /models?|types|schema/i.test(n.path) || /Model$/.test(n.label)), "Defines the data everything else works with.");
  hubs.forEach(n => addStart(n, "Heavily used building block – most features import it."));
  start.splice(5);

  /* ---------- What the authors write themselves ---------- */
  const docs = [];
  for (const sec of archSections(DATA.readme)) docs.push({ title: sec.title, source: "README", blocks: mdBlocks(sec.body), rels: mermaidRelations(sec.body) });
  if (!docs.some(d => d.rels.length)) { const rels = mermaidRelations(DATA.readme); if (rels.length) docs.push({ title: "Diagram in the README", source: "README", blocks: [], rels }); }
  if (DATA.archDoc?.text) {
    const body = DATA.archDoc.text.replace(/^#[^\n]*\n/, "");
    docs.push({ title: basename(DATA.archDoc.path), source: DATA.archDoc.path, url: DATA.source !== "local" ? `https://github.com/${DATA.repo}/blob/${encodeURIComponent(DATA.branch)}/${DATA.archDoc.path}` : null, blocks: mdBlocks(body, 1100), rels: mermaidRelations(DATA.archDoc.text) });
  }

  /* ---------- Tour ---------- */
  const tour = [];
  const pushT = id => { if (id && byId.has(id) && !tour.includes(id)) tour.push(id); };
  if (user) pushT(user.id); if (shell) pushT(shell.id);
  (flows[0]?.path || []).forEach(pushT);
  for (const l of layers) l.nodes.slice(0, l.k === "ext" ? 3 : 2).forEach(pushT);
  hubs.forEach(n => pushT(n.id));
  tour.splice(12);

  return { summary, layers, flows, start, docs, nodeInfo, tour };
}
