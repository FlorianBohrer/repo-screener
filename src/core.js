"use strict";
/* ============ Grundlagen ============ */
const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v; else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const svgUse = id => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); const u = document.createElementNS("http://www.w3.org/2000/svg", "use"); u.setAttribute("href", "#" + id); s.append(u); return s; };
const fmtBytes = b => b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(b < 10240 ? 1 : 0) + " KB" : (b / 1048576).toFixed(1) + " MB";
const fmtInt = n => n.toLocaleString("de-DE");
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
/* Farbe als deckendes Hex (Mermaid-classDef verträgt keine Kommas aus rgba) – Alpha wird auf den Inhaltsgrund gemischt */
function solid(name) {
  const parse = v => { const c = document.createElement("canvas").getContext("2d"); c.fillStyle = "#000"; c.fillStyle = v; const f = c.fillStyle;
    if (f.startsWith("#")) return [parseInt(f.slice(1, 3), 16), parseInt(f.slice(3, 5), 16), parseInt(f.slice(5, 7), 16), 1];
    const m = f.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2], m[3] ?? 1]; };
  const [r, g, b, a] = parse(css(name)); const [br, bg, bb] = parse(css("--content"));
  const mix = (x, y) => Math.round(x * a + y * (1 - a)).toString(16).padStart(2, "0");
  return "#" + mix(r, br) + mix(g, bg) + mix(b, bb);
}
const dirname = p => p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
const basename = p => p.slice(p.lastIndexOf("/") + 1);

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "target", "vendor", "__pycache__", ".venv", "venv", ".turbo", ".cache", "coverage", ".idea", ".vscode", ".pytest_cache", ".mypy_cache"]);

/* Sprachen: Erweiterung → [Name, Farbe] (Linguist-nahe Farben) */
const LANGS = {
  ts:["TypeScript","#3178c6"], tsx:["TypeScript","#3178c6"], mts:["TypeScript","#3178c6"], cts:["TypeScript","#3178c6"],
  js:["JavaScript","#e3c427"], jsx:["JavaScript","#e3c427"], mjs:["JavaScript","#e3c427"], cjs:["JavaScript","#e3c427"],
  py:["Python","#3572a5"], ipynb:["Jupyter","#da5b0b"], go:["Go","#00add8"], rs:["Rust","#c46a3a"], java:["Java","#b07219"], kt:["Kotlin","#a97bff"],
  swift:["Swift","#f05138"], rb:["Ruby","#a91401"], php:["PHP","#4f5d95"], cs:["C#","#178600"], c:["C","#6e6e6e"], h:["C","#6e6e6e"],
  cpp:["C++","#f34b7d"], cc:["C++","#f34b7d"], hpp:["C++","#f34b7d"], scala:["Scala","#c22d40"], dart:["Dart","#00b4ab"], ex:["Elixir","#6e4a7e"], exs:["Elixir","#6e4a7e"],
  vue:["Vue","#41b883"], svelte:["Svelte","#ff3e00"], astro:["Astro","#ff5a03"], html:["HTML","#e34c26"], css:["CSS","#663399"], scss:["SCSS","#c6538c"],
  sh:["Shell","#89e051"], bash:["Shell","#89e051"], ps1:["PowerShell","#012456"], sql:["SQL","#e38c00"], lua:["Lua","#000080"], r:["R","#198ce7"],
  md:["Markdown","#7a8a84"], mdx:["MDX","#7a8a84"], json:["JSON","#9aa69f"], jsonc:["JSON","#9aa69f"], yml:["YAML","#cb171e"], yaml:["YAML","#cb171e"], toml:["TOML","#9c4221"],
  tf:["HCL","#844fba"], dockerfile:["Dockerfile","#384d54"], prisma:["Prisma","#0c344b"], graphql:["GraphQL","#e10098"], proto:["Protobuf","#5a6b8c"],
};
const ASSET_EXT = new Set(["png","jpg","jpeg","gif","svg","ico","webp","avif","woff","woff2","ttf","otf","eot","mp3","mp4","wav","webm","mov","pdf","zip","gz","lock","map"]);
function langOf(path) {
  const b = basename(path).toLowerCase();
  if (b === "dockerfile" || b.startsWith("dockerfile.")) return LANGS.dockerfile;
  const ext = b.includes(".") ? b.slice(b.lastIndexOf(".") + 1) : "";
  if (LANGS[ext]) return LANGS[ext];
  if (ASSET_EXT.has(ext) || b.endsWith(".lock") || b.endsWith("-lock.yaml") || b === "bun.lockb") return ["Assets/Lockfiles", "#b9c3bf"];
  return ["Sonstige", "#c9d1ce"];
}
const isCode = p => /\.(m?[jt]sx?|[cm]ts|py|go|rs|java|kt|swift|rb|php|cs|c|h|cpp|cc|hpp|scala|dart|exs?|vue|svelte|astro)$/i.test(p);
const isTest = p => /(^|\/)(tests?|__tests__|spec|e2e|cypress|playwright)(\/|$)|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py)$/i.test(p);
const isImportable = p => /\.(m?[jt]sx?|[cm]ts|py|vue|svelte)$/i.test(p);

/* ============ Kategorien (Architektur-Schichten) ============ */
const CATS = {
  frontend:{label:"Frontend / UI", rx:/^(app|pages|components?|ui|views?|screens?|hooks|styles?|public|static|assets|frontend|web|client|features|layouts?|templates|widgets|www|site|mcp-app)$/i},
  backend:{label:"Backend / API", rx:/^(server|api|routes?|controllers?|handlers?|services?|backend|workers?|functions|lambdas?|middleware|jobs|queues?|cmd|grpc|graphql|resolvers|endpoints|proxy)$/i},
  core:{label:"Kern & Daten", rx:/^(lib|libs|core|utils?|helpers|common|shared|models?|db|database|schema|entities|domain|store|stores|state|types|internal|pkg|packages|src|data|prisma|migrations|config)$/i},
  infra:{label:"Infrastruktur & CI", rx:/^(\.github|\.gitlab|\.circleci|docker|deploy|deployment|infra|infrastructure|k8s|kubernetes|helm|terraform|ops|cloudflare|scripts|bin|\.githooks|ci|\.devcontainer|nginx|ansible)$/i},
  tests:{label:"Tests", rx:/^(tests?|__tests__|spec|specs|e2e|cypress|playwright|fixtures|testing)$/i},
  docs:{label:"Dokumentation", rx:/^(docs?|documentation|wiki|guides?|examples?|samples?)$/i},
  tooling:{label:"Tooling & Experimente", rx:/^(tools?|experiments?|plugins?|extensions?|benchmarks?|bench|playground|sandbox|patches|contrib|hack)$/i},
  config:{label:"Projektwurzel / Konfiguration", rx:/^$/},
};
const CAT_ORDER = ["frontend","backend","core","infra","tooling","tests","docs","config"];
function categorize(compPath, hint) {
  if (compPath === "") return "config";
  const segs = compPath.split("/");
  for (let i = segs.length - 1; i >= 0; i--) {
    for (const c of CAT_ORDER) if (c !== "config" && CATS[c].rx.test(segs[i])) {
      if (c === "core" && i < segs.length - 1) continue; /* "src/…": nicht pauschal Kern */
      return c;
    }
  }
  if (hint) { const h = hint.toLowerCase();
    if (/front|ui|client|web|view|komponent/.test(h)) return "frontend";
    if (/back|api|server|worker|dienst|service/.test(h)) return "backend";
    if (/infra|deploy|ci|build|cloud|devops/.test(h)) return "infra";
    if (/test/.test(h)) return "tests"; if (/doc/.test(h)) return "docs";
    if (/tool|experiment|plugin|skript/.test(h)) return "tooling";
    if (/daten|data|kern|core|lib|model|store|shared|util/.test(h)) return "core";
  }
  return "core";
}

/* ============ Importe extrahieren & auflösen ============ */
const JS_IMPORT_RX = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\(\s*|export\s[^'"]*?from\s*|^import\s+)['"]([^'"]+)['"]/gm;
const PY_IMPORT_RX = /^\s*(?:from\s+(\.*[\w.]*)\s+import|import\s+([\w.]+(?:\s*,\s*[\w.]+)*))/gm;
function extractImports(path, text) {
  const out = new Set();
  if (/\.py$/i.test(path)) {
    for (const m of text.matchAll(PY_IMPORT_RX)) {
      if (m[1]) out.add("py:" + m[1]);
      else if (m[2]) for (const x of m[2].split(",")) out.add("py:" + x.trim());
    }
  } else {
    for (const m of text.matchAll(JS_IMPORT_RX)) if (/^(\.|@\/|~\/)/.test(m[1])) out.add(m[1]);
  }
  return [...out];
}
function normPath(p) {
  const out = [];
  for (const s of p.split("/")) { if (!s || s === ".") continue; if (s === "..") out.pop(); else out.push(s); }
  return out.join("/");
}
const JS_EXT = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".vue", ".svelte", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];
function resolveImport(from, spec, fileSet, aliasRoot) {
  if (spec.startsWith("py:")) {
    let mod = spec.slice(3), base;
    const dots = mod.match(/^\.*/)[0].length;
    if (dots) { base = dirname(from).split("/").filter(Boolean); for (let i = 1; i < dots; i++) base.pop(); mod = mod.slice(dots); base = base.join("/"); }
    const parts = mod ? mod.split(".") : [];
    const roots = dots ? [base] : ["", "src", aliasRoot || ""];
    for (const r of roots) for (let n = parts.length; n >= (dots ? 0 : 1); n--) {
      const p = normPath((r ? r + "/" : "") + parts.slice(0, n).join("/"));
      if (fileSet.has(p + ".py")) return p + ".py";
      if (fileSet.has(p + "/__init__.py")) return p + "/__init__.py";
    }
    return null;
  }
  let base;
  if (spec.startsWith("@/") || spec.startsWith("~/")) base = (aliasRoot ? aliasRoot + "/" : "") + spec.slice(2);
  else base = (dirname(from) ? dirname(from) + "/" : "") + spec;
  base = normPath(base);
  const tries = [base]; if (/\.js$/.test(base)) tries.push(base.replace(/\.js$/, ""));
  for (const b of tries) for (const e of JS_EXT) if (fileSet.has(b + e)) return b + e;
  return null;
}

/* ============ Analyse ============ */
function analyze(data) {
  const files = data.files.map(([path, size]) => ({ path, size }));
  const fileSet = new Set(files.map(f => f.path));
  const total = files.reduce((a, f) => a + f.size, 0);

  /* Sprachen */
  const lang = new Map();
  for (const f of files) { const [n, c] = langOf(f.path); const o = lang.get(n) || { name: n, color: c, bytes: 0, files: 0 }; o.bytes += f.size; o.files++; lang.set(n, o); }
  const langs = [...lang.values()].sort((a, b) => b.bytes - a.bytes);

  /* Komponenten: Verzeichnisbaum adaptiv aufteilen */
  const dirCount = new Map(); /* dir → Anzahl Dateien darunter */
  for (const f of files) { const segs = f.path.split("/"); for (let i = 1; i < segs.length; i++) { const d = segs.slice(0, i).join("/"); dirCount.set(d, (dirCount.get(d) || 0) + 1); } }
  const childrenOf = d => [...dirCount.keys()].filter(k => dirname(k) === d && k !== d);
  let comps = new Set(childrenOf(""));
  const WRAP = /^(src|packages|apps|services|modules|internal|pkg|libs|crates)$/i;
  const totalFiles = files.length;
  for (let guard = 0; guard < 40; guard++) {
    if (comps.size >= 22) break;
    let best = null;
    for (const c of comps) {
      const kids = childrenOf(c); if (kids.length < 2) continue;
      const n = dirCount.get(c), wrap = WRAP.test(basename(c));
      const weight = wrap ? n * 10 : n;
      if ((wrap || n > totalFiles * 0.18) && (!best || weight > best.w)) best = { c, w: weight };
    }
    if (!best) break;
    comps.delete(best.c); for (const k of childrenOf(best.c)) comps.add(k);
    comps.add(best.c + "/*");
  }
  /* Dateien den Komponenten zuordnen */
  const compList = [...comps];
  const compOf = path => {
    let bestc = "", bl = -1;
    for (const c of compList) {
      const real = c.endsWith("/*") ? c.slice(0, -2) : c;
      if (c.endsWith("/*") ? dirname(path) === real : (path.startsWith(real + "/"))) { if (real.length > bl) { bestc = c; bl = real.length; } }
    }
    return bestc;
  };
  const compMap = new Map();
  const ensure = key => { if (!compMap.has(key)) compMap.set(key, { key, files: [], bytes: 0 }); return compMap.get(key); };
  const fileComp = new Map();
  for (const f of files) { const k = compOf(f.path); const o = ensure(k); o.files.push(f); o.bytes += f.size; fileComp.set(f.path, k); }
  /* Kleine Komponenten (≤1 Datei) mit Wurzel-Konfiguration zusammenlegen, wenn viele */
  let compsArr = [...compMap.values()];
  if (compsArr.length > 26) {
    compsArr.sort((a, b) => a.files.length - b.files.length);
    while (compsArr.length > 26) { const small = compsArr.shift(); const tgt = ensure(""); tgt.files.push(...small.files); tgt.bytes += small.bytes; small.files.forEach(f => fileComp.set(f.path, "")); compMap.delete(small.key); compsArr = [...compMap.values()].filter(c => c.key !== "").sort((a, b) => a.files.length - b.files.length); compsArr.push(compMap.get("")); compsArr.sort((a, b) => a.files.length - b.files.length); }
  }
  const aliasRoot = fileSet.has("tsconfig.json") && [...fileSet].some(p => p.startsWith("src/")) ? "src" : "";
  const nodes = [...compMap.values()].map((c, i) => {
    const real = c.key.endsWith("/*") ? c.key.slice(0, -2) : c.key;
    const label = c.key === "" ? "Projektwurzel" : c.key.endsWith("/*") ? basename(real) + " (Dateien)" : c.key.split("/").slice(-2).join("/");
    const testShare = c.files.filter(f => isTest(f.path)).length / Math.max(1, c.files.length);
    const cat = testShare > 0.6 ? "tests" : categorize(c.key.endsWith("/*") ? "" : real === "" ? "" : real);
    return { id: "n" + i, key: c.key, path: real, label, cat: c.key.endsWith("/*") && real ? categorize(real) : cat, files: c.files, bytes: c.bytes, isDir: c.key !== "" && !c.key.endsWith("/*") };
  });
  const nodeByKey = new Map(nodes.map(n => [n.key, n]));

  /* Kanten aus Importen */
  const edgeW = new Map(); const fileEdges = [];
  let resolved = 0, analysed = 0;
  for (const [from, specs] of Object.entries(data.imports || {})) {
    if (!fileSet.has(from)) continue; analysed++;
    const testFile = isTest(from);
    for (const s of specs) {
      const to = resolveImport(from, s, fileSet, aliasRoot); if (!to) continue; resolved++;
      fileEdges.push([from, to]);
      if (testFile || isTest(to)) continue;
      const a = nodeByKey.get(fileComp.get(from)), b = nodeByKey.get(fileComp.get(to));
      if (!a || !b || a === b) continue;
      const k = a.id + ">" + b.id; edgeW.set(k, (edgeW.get(k) || 0) + 1);
    }
  }
  let edges = [...edgeW.entries()].map(([k, w]) => { const [from, to] = k.split(">"); return { from, to, w }; }).sort((a, b) => b.w - a.w);
  const allEdges = edges; edges = edges.filter((e, i) => i < 14 || e.w >= 2).slice(0, 36);

  /* Stack */
  const has = rx => files.some(f => rx.test(f.path));
  const deps = new Set(data.deps || []);
  const dep = (...n) => n.some(x => deps.has(x));
  const STACK = [
    ["TypeScript", has(/(^|\/)tsconfig[^/]*\.json$/)], ["Node.js", has(/(^|\/)package\.json$/)], ["Bun", has(/(^|\/)bun\.lockb?$/)], ["Deno", has(/(^|\/)deno\.jsonc?$/)],
    ["Next.js", has(/(^|\/)next\.config\.[cm]?[jt]s$/) || dep("next")], ["React", dep("react")], ["Vue", dep("vue") || has(/\.vue$/)], ["Svelte", dep("svelte") || has(/\.svelte$/)],
    ["Angular", dep("@angular/core")], ["Vite", has(/(^|\/)vite\.config\./)], ["Tailwind CSS", has(/tailwind\.config\./) || dep("tailwindcss")],
    ["Express", dep("express")], ["Fastify", dep("fastify")], ["Hono", dep("hono")], ["NestJS", dep("@nestjs/core")],
    ["Prisma", has(/\.prisma$/) || dep("prisma", "@prisma/client")], ["Drizzle", dep("drizzle-orm")], ["Zod", dep("zod")],
    ["Python", has(/(^|\/)(requirements[^/]*\.txt|pyproject\.toml|setup\.py|Pipfile)$/)], ["Django", has(/(^|\/)manage\.py$/)], ["FastAPI", deps.has("fastapi")],
    ["Go", has(/(^|\/)go\.mod$/)], ["Rust", has(/(^|\/)Cargo\.toml$/)], ["Java/Gradle", has(/(^|\/)build\.gradle(\.kts)?$/)], ["Java/Maven", has(/(^|\/)pom\.xml$/)],
    ["Ruby", has(/(^|\/)Gemfile$/)], ["PHP/Composer", has(/(^|\/)composer\.json$/)], [".NET", has(/\.(csproj|sln)$/)],
    ["Docker", has(/(^|\/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|compose\.ya?ml)$/)], ["Kubernetes", has(/(^|\/)(k8s|helm|charts)\//)], ["Terraform", has(/\.tf$/)],
    ["GitHub Actions", has(/^\.github\/workflows\//)], ["GitLab CI", has(/^\.gitlab-ci\.yml$/)], ["Cloudflare Workers", has(/(^|\/)wrangler[^/]*\.(toml|jsonc?)$/)], ["Vercel", has(/(^|\/)vercel\.json$/)],
    ["Railway", has(/(^|\/)railway\.json$/)], ["Vitest", has(/vitest\.config\./) || dep("vitest")], ["Jest", has(/jest\.config\./) || dep("jest")], ["Playwright", has(/playwright\.config\./) || dep("@playwright/test")],
    ["pytest", has(/(^|\/)(pytest\.ini|conftest\.py)$/)], ["ESLint", has(/(^|\/)(\.eslintrc[^/]*|eslint\.config\.[cm]?js)$/)], ["Prettier", has(/(^|\/)(\.prettierrc[^/]*|prettier\.config\.[cm]?js)$/)],
    ["OpenAI SDK", dep("openai")], ["Anthropic SDK", dep("@anthropic-ai/sdk", "anthropic")], ["Mermaid", dep("mermaid")], ["Stripe", dep("stripe")], ["MCP", dep("@modelcontextprotocol/server", "@modelcontextprotocol/sdk", "mcp")],
  ].filter(x => x[1]).map(x => x[0]);

  /* Screening */
  const code = files.filter(f => isCode(f.path));
  const tests = code.filter(f => isTest(f.path));
  const src = code.length - tests.length;
  const ratio = tests.length / Math.max(1, src);
  const big = files.filter(f => f.size > 1048576 && !/\.(png|jpe?g|gif|mp4|webm|woff2?|pdf)$/i.test(f.path));
  const mdCount = files.filter(f => /\.mdx?$/i.test(f.path)).length;
  const envCommitted = files.filter(f => /(^|\/)\.env(\.local|\.production)?$/.test(f.path));
  const checks = [
    { t: "README", s: has(/^readme(\.\w+)?$/i) ? "ok" : "bad", w: has(/^readme(\.\w+)?$/i) ? "Im Wurzelverzeichnis vorhanden" : "Keine README im Wurzelverzeichnis" },
    { t: "Lizenz", s: has(/^(licen[cs]e|copying)(\.\w+)?$/i) ? "ok" : "warn", w: has(/^(licen[cs]e|copying)(\.\w+)?$/i) ? "Lizenzdatei gefunden" : "Ohne Lizenz ist die Nutzung rechtlich unklar" },
    { t: "Continuous Integration", s: has(/^(\.github\/workflows\/|\.gitlab-ci\.yml|\.circleci\/|azure-pipelines\.yml|Jenkinsfile|\.buildkite\/)/) ? "ok" : "warn", w: (() => { const n = files.filter(f => /^\.github\/workflows\//.test(f.path)).length; return n ? n + " GitHub-Workflow" + (n > 1 ? "s" : "") : has(/^(\.gitlab-ci\.yml|\.circleci\/|azure-pipelines\.yml|Jenkinsfile)/) ? "CI-Konfiguration gefunden" : "Keine CI-Pipeline erkannt"; })() },
    { t: "Tests", s: tests.length === 0 ? "bad" : ratio < 0.08 ? "warn" : "ok", w: tests.length === 0 ? "Keine Testdateien erkannt" : `${fmtInt(tests.length)} Testdateien auf ${fmtInt(src)} Quelldateien (${(ratio * 100).toFixed(0)} %)` },
    { t: "Dokumentation", s: has(/^docs?\//i) || mdCount > 4 ? "ok" : "warn", w: `${mdCount} Markdown-Datei${mdCount === 1 ? "" : "en"}${has(/^docs?\//i) ? ", eigener docs-Ordner" : ""}` },
    { t: "Reproduzierbare Abhängigkeiten", s: has(/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|poetry\.lock|uv\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/) ? "ok" : (has(/(^|\/)(package\.json|pyproject\.toml|Cargo\.toml|go\.mod)$/) ? "warn" : "na"), w: has(/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|poetry\.lock|uv\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/) ? "Lockfile eingecheckt" : "Kein Lockfile gefunden" },
    { t: "Code-Qualität (Lint/Format)", s: has(/(^|\/)(\.eslintrc[^/]*|eslint\.config\.[cm]?js|\.prettierrc[^/]*|prettier\.config\.[cm]?js|biome\.jsonc?|ruff\.toml|\.flake8|\.editorconfig|\.golangci\.ya?ml|rustfmt\.toml|\.rubocop\.yml)$/) ? "ok" : "warn", w: has(/(^|\/)(\.eslintrc[^/]*|eslint\.config\.[cm]?js|\.prettierrc[^/]*|prettier\.config\.[cm]?js|biome\.jsonc?|ruff\.toml|\.flake8|\.editorconfig|\.golangci\.ya?ml|rustfmt\.toml|\.rubocop\.yml)$/) ? "Linter- oder Formatter-Konfiguration vorhanden" : "Keine Lint-/Format-Konfiguration erkannt" },
    { t: "Container / Deployment", s: has(/(^|\/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|compose\.ya?ml|wrangler[^/]*\.(toml|jsonc?)|vercel\.json|netlify\.toml|fly\.toml|railway\.json|Procfile)$/) ? "ok" : "na", w: has(/(^|\/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|compose\.ya?ml|wrangler[^/]*\.(toml|jsonc?)|vercel\.json|netlify\.toml|fly\.toml|railway\.json|Procfile)$/) ? "Deployment-Konfiguration gefunden" : "Keine Deployment-Konfiguration" },
    { t: "Geheimnisse", s: envCommitted.length ? "bad" : "ok", w: envCommitted.length ? envCommitted.map(f => f.path).join(", ") + " ist eingecheckt" : has(/\.env\.(example|sample|template)$/) ? "Nur .env-Vorlage eingecheckt" : "Keine .env-Datei eingecheckt" },
    { t: "Große Dateien", s: big.length ? "warn" : "ok", w: big.length ? big.length + " Datei(en) über 1 MB, z. B. " + big[0].path : "Keine Nicht-Mediendatei über 1 MB" },
  ];
  const scored = checks.filter(c => c.s !== "na");
  const score = Math.round(scored.reduce((a, c) => a + (c.s === "ok" ? 1 : c.s === "warn" ? 0.5 : 0), 0) / Math.max(1, scored.length) * 100);

  return { files, fileSet, total, langs, nodes, edges, allEdges, fileEdges, fileComp, nodeByKey, stack: STACK, checks, score, code: code.length, tests: tests.length, analysed, resolved };
}

/* ============ Mermaid kompilieren ============ */
function esc(s) { return String(s).replace(/[&]/g, "and").replace(/"/g, "#quot;").replace(/</g, "#lt;").replace(/>/g, "#gt;").replace(/#(?!quot;|lt;|gt;)/g, "#35;").replace(/[\[\]{}|]/g, " "); }
function compileMermaid(ast, dir) {
  const L = [`flowchart ${dir}`];
  const byGroup = new Map();
  for (const n of ast.nodes) { const g = n.group || CATS[n.cat]?.label || "Weitere"; if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(n); }
  let gi = 0;
  const groupKeys = [...byGroup.keys()].sort((a, b) => {
    const ca = CAT_ORDER.indexOf(byGroup.get(a)[0].cat), cb = CAT_ORDER.indexOf(byGroup.get(b)[0].cat); return ca - cb;
  });
  for (const g of groupKeys) {
    L.push(`  subgraph g${gi++}["${esc(g)}"]`);
    L.push(`    direction ${dir === "TD" ? "LR" : "TB"}`);
    for (const n of byGroup.get(g)) {
      const sub = n.sub ? `<br/><small>${esc(n.sub)}</small>` : "";
      const shape = n.cat === "config" ? [`[/"`, `"/]`] : n.cat === "core" ? [`[("`, `")]`] : [`["`, `"]`];
      L.push(`    ${n.id}${shape[0]}<b>${esc(n.label)}</b>${sub}${shape[1]}`);
    }
    L.push("  end");
  }
  const maxW = Math.max(1, ...ast.edges.map(e => e.w || 1));
  for (const e of ast.edges) {
    const heavy = e.w && e.w >= Math.max(4, maxW * 0.35);
    const lbl = e.label ? `|"${esc(e.label)}"|` : "";
    L.push(`  ${e.from} ${heavy ? "==>" : "-->"}${lbl} ${e.to}`);
  }
  for (const c of CAT_ORDER) {
    L.push(`  classDef ${c} fill:${solid("--c-" + c + "-bg")},stroke:${solid("--c-" + c)},stroke-width:1.5px,color:${solid("--label")}`);
    const ids = ast.nodes.filter(n => n.cat === c).map(n => n.id);
    if (ids.length) L.push(`  class ${ids.join(",")} ${c}`);
  }
  return L.join("\n");
}
function heuristicAst(A) {
  const linked = new Set(A.edges.flatMap(e => [e.from, e.to]));
  const nodes = A.nodes.filter(n => n.files.length > 0).map(n => ({
    id: n.id, label: n.label, cat: n.cat, path: n.path, isDir: n.isDir,
    sub: `${fmtInt(n.files.length)} Dateien · ${fmtBytes(n.bytes)}`, linked: linked.has(n.id),
  }));
  return { nodes, edges: A.edges.map(e => ({ ...e, label: String(e.w) })) };
}


/* ============ Laden: GitHub ============ */
function parseRepo(s) {
  s = s.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const m = s.match(/(?:github\.com[/:])?([\w.-]+)\/([\w.-]+)(?:\/tree\/([^?#]+))?/);
  return m ? { owner: m[1], repo: m[2], ref: m[3] } : null;
}
async function gh(path, token, accept = "application/vnd.github+json") {
  const r = await fetch("https://api.github.com" + path, { headers: { Accept: accept, ...(token ? { Authorization: "Bearer " + token } : {}) } });
  if (!r.ok) { const e = new Error(r.status === 404 ? "Repository nicht gefunden oder privat (Token angeben)." : r.status === 403 || r.status === 429 ? "GitHub-Ratenlimit erreicht. Mit Token erneut versuchen oder später." : "GitHub antwortet mit " + r.status); e.status = r.status; throw e; }
  return accept.includes("raw") ? r.text() : r.json();
}
async function loadGitHub(input) {
  const p = parseRepo(input); if (!p) throw new Error("Bitte im Format owner/repo oder als GitHub-URL eingeben.");
  const token = $("#tokenInput").value.trim();
  logStart();
  let s = logStep(`Repository ${p.owner}/${p.repo} abrufen …`);
  let meta;
  try { meta = await gh(`/repos/${p.owner}/${p.repo}`, token); }
  catch (e) { if (e instanceof TypeError) throw new Error("Netzwerkzugriff auf GitHub ist in dieser Ansicht blockiert. Öffne die Datei index.html lokal im Browser oder nutze »Ordner wählen«."); throw e; }
  const branch = p.ref || meta.default_branch; logDone(s, `Repository gefunden · Branch ${branch} · ★ ${fmtInt(meta.stargazers_count || 0)}`);
  s = logStep("Dateibaum laden …");
  const tree = await gh(`/repos/${p.owner}/${p.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, token);
  const files = tree.tree.filter(t => t.type === "blob" && !t.path.split("/").some(x => IGNORE_DIRS.has(x))).map(t => [t.path, t.size || 0]);
  logDone(s, `${fmtInt(files.length)} Dateien${tree.truncated ? " (von GitHub gekürzt)" : ""}`);
  const raw = async path => token
    ? gh(`/repos/${p.owner}/${p.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`, token, "application/vnd.github.raw")
    : fetch(`https://raw.githubusercontent.com/${p.owner}/${p.repo}/${encodeURIComponent(branch)}/${path.split("/").map(encodeURIComponent).join("/")}`).then(r => r.ok ? r.text() : "");
  s = logStep("README und Manifeste lesen …");
  const readmePath = files.find(f => /^readme(\.md|\.rst|\.txt)?$/i.test(f[0]))?.[0];
  const readme = readmePath ? (await raw(readmePath).catch(() => "")).slice(0, 4000) : "";
  const deps = [];
  for (const mf of files.filter(f => /(^|\/)package\.json$/.test(f[0])).slice(0, 4)) {
    try { const pj = JSON.parse(await raw(mf[0])); deps.push(...Object.keys(pj.dependencies || {}), ...Object.keys(pj.devDependencies || {})); } catch {}
  }
  const req = files.find(f => /(^|\/)requirements\.txt$/.test(f[0]));
  if (req) { try { (await raw(req[0])).split("\n").forEach(l => { const m = l.trim().match(/^([A-Za-z0-9_.-]+)/); if (m && !l.startsWith("#")) deps.push(m[1].toLowerCase()); }); } catch {} }
  logDone(s, `README ${readme ? "gelesen" : "fehlt"} · ${deps.length} Abhängigkeiten`);
  /* Quellcode-Stichprobe: gleichmäßig über Top-Ordner verteilt (wie GitDiagram: begrenzte Auszüge) */
  const cand = files.filter(f => isImportable(f[0]) && !isTest(f[0]) && f[1] < 200000);
  const buckets = new Map(); cand.forEach(f => { const k = f[0].split("/").slice(0, 2).join("/"); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(f); });
  const pick = []; const LIMIT = token ? 160 : 220; let round = 0;
  const bl = [...buckets.values()]; bl.forEach(b => b.sort((a, c) => c[1] - a[1]));
  while (pick.length < LIMIT && bl.some(b => b.length > round)) { for (const b of bl) if (b[round] && pick.length < LIMIT) pick.push(b[round]); round++; }
  s = logStep(`Quellcode lesen: 0 / ${pick.length}`);
  const imports = {}; let done = 0;
  const queue = [...pick];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) { const f = queue.shift(); try { const t = await raw(f[0]); const sp = extractImports(f[0], t); if (sp.length) imports[f[0]] = sp; } catch {} done++; s.lastChild.textContent = `Quellcode lesen: ${done} / ${pick.length}`; }
  }));
  logDone(s, `${pick.length} Quelldateien gelesen, ${Object.keys(imports).length} mit Importen`);
  return { source: "github", repo: `${p.owner}/${p.repo}`, branch, description: meta.description, files, imports, readme, deps, truncated: tree.truncated };
}

/* ============ Laden: lokaler Ordner ============ */
async function loadLocal(fileList) {
  const all = [...fileList]; if (!all.length) throw new Error("Der Ordner ist leer.");
  logStart();
  const rootName = (all[0].webkitRelativePath || all[0].name).split("/")[0];
  const items = all.map(f => ({ f, path: (f.webkitRelativePath || f.name).split("/").slice(1).join("/") }))
    .filter(x => x.path && !x.path.split("/").some(s => IGNORE_DIRS.has(s)));
  let s = logStep(`${fmtInt(items.length)} Dateien aus »${rootName}« erfasst`); logDone(s);
  const files = items.map(x => [x.path, x.f.size]);
  const imports = {}; let readme = "", deps = [];
  const src = items.filter(x => isImportable(x.path) && x.f.size < 400000).slice(0, 4000);
  s = logStep(`Importe analysieren: 0 / ${src.length}`);
  let i = 0;
  for (const x of src) { const sp = extractImports(x.path, await x.f.text()); if (sp.length) imports[x.path] = sp; if (++i % 50 === 0) s.lastChild.textContent = `Importe analysieren: ${i} / ${src.length}`; }
  logDone(s, `${src.length} Quelldateien analysiert`);
  const rd = items.find(x => /^readme(\.md|\.rst|\.txt)?$/i.test(x.path)); if (rd) readme = (await rd.f.text()).slice(0, 4000);
  for (const x of items.filter(x => /(^|\/)package\.json$/.test(x.path)).slice(0, 6)) { try { const pj = JSON.parse(await x.f.text()); deps.push(...Object.keys(pj.dependencies || {}), ...Object.keys(pj.devDependencies || {})); } catch {} }
  const rq = items.find(x => /(^|\/)requirements\.txt$/.test(x.path)); if (rq) (await rq.f.text()).split("\n").forEach(l => { const m = l.trim().match(/^([A-Za-z0-9_.-]+)/); if (m && !l.startsWith("#")) deps.push(m[1].toLowerCase()); });
  return { source: "local", repo: rootName, branch: "", files, imports, readme, deps };
}

