"use strict";
/* ============ Basics ============ */
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
const fmtInt = n => n.toLocaleString("en-US");
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
/* Color as opaque hex (Mermaid classDef cannot handle the commas in rgba) – alpha is blended onto the surface color */
function solid(name) {
  const parse = v => { const c = document.createElement("canvas").getContext("2d"); c.fillStyle = "#000"; c.fillStyle = v; const f = c.fillStyle;
    if (f.startsWith("#")) return [parseInt(f.slice(1, 3), 16), parseInt(f.slice(3, 5), 16), parseInt(f.slice(5, 7), 16), 1];
    const m = f.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2], m[3] ?? 1]; };
  const [r, g, b, a] = parse(css(name)); const [br, bg, bb] = parse(css("--surface"));
  const mix = (x, y) => Math.round(x * a + y * (1 - a)).toString(16).padStart(2, "0");
  return "#" + mix(r, br) + mix(g, bg) + mix(b, bb);
}
const dirname = p => p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
const basename = p => p.slice(p.lastIndexOf("/") + 1);

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "target", "vendor", "__pycache__", ".venv", "venv", ".turbo", ".cache", "coverage", ".idea", ".vscode", ".pytest_cache", ".mypy_cache"]);

/* Languages: extension → [name, color] (colors close to GitHub Linguist) */
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
  if (ASSET_EXT.has(ext) || b.endsWith(".lock") || b.endsWith("-lock.yaml") || b === "bun.lockb") return ["Assets/lockfiles", "#b9c3bf"];
  return ["Other", "#c9d1ce"];
}
const isCode = p => /\.(m?[jt]sx?|[cm]ts|py|go|rs|java|kt|swift|rb|php|cs|c|h|cpp|cc|hpp|scala|dart|exs?|vue|svelte|astro)$/i.test(p);
const isTest = p => /(^|\/)(tests?|__tests__|spec|e2e|cypress|playwright)(\/|$)|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py)$/i.test(p);
const isImportable = p => /\.(m?[jt]sx?|[cm]ts|py|vue|svelte)$/i.test(p);

/* ============ Categories (architecture layers) ============ */
const CATS = {
  frontend:{label:"Frontend / UI", rx:/^(app|pages|components?|ui|views?|screens?|hooks|styles?|public|static|assets|frontend|web|client|features|layouts?|templates|widgets|www|site|mcp-app)$/i},
  backend:{label:"Backend / API", rx:/^(server|api|routes?|controllers?|handlers?|services?|backend|workers?|functions|lambdas?|middleware|jobs|queues?|cmd|grpc|graphql|resolvers|endpoints|proxy)$/i},
  core:{label:"Core & Data", rx:/^(lib|libs|core|utils?|helpers|common|shared|models?|db|database|schema|entities|domain|store|stores|state|types|internal|pkg|packages|src|data|prisma|migrations|config)$/i},
  infra:{label:"Infrastructure & CI", rx:/^(\.github|\.gitlab|\.circleci|docker|deploy|deployment|infra|infrastructure|k8s|kubernetes|helm|terraform|ops|cloudflare|scripts|bin|\.githooks|ci|\.devcontainer|nginx|ansible)$/i},
  tests:{label:"Tests", rx:/^(tests?|__tests__|spec|specs|e2e|cypress|playwright|fixtures|testing)$/i},
  docs:{label:"Documentation", rx:/^(docs?|documentation|wiki|guides?|examples?|samples?)$/i},
  tooling:{label:"Tooling & Experiments", rx:/^(tools?|experiments?|plugins?|extensions?|benchmarks?|bench|playground|sandbox|patches|contrib|hack)$/i},
  config:{label:"Project Root / Config", rx:/^$/},
  external:{label:"External Services", rx:/^$/},
  user:{label:"User", rx:/^$/},
};
const CAT_ORDER = ["user","frontend","backend","core","infra","tooling","tests","docs","config","external"];
function categorize(compPath, hint) {
  if (compPath === "") return "config";
  const segs = compPath.split("/");
  for (let i = segs.length - 1; i >= 0; i--) {
    for (const c of CAT_ORDER) if (c !== "config" && c !== "external" && c !== "user" && CATS[c].rx.test(segs[i])) {
      if (c === "core" && i < segs.length - 1) continue; /* "src/…": not core by default */
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

/* ============ Extracting & resolving imports ============ */
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
    for (const m of text.matchAll(JS_IMPORT_RX)) {
      const sp = m[1];
      if (/^(\.|@\/|~\/)/.test(sp)) out.add(sp);
      else if (/^(@[\w.-]+\/)?[\w.-]+/.test(sp) && !/^(node:|https?:)/.test(sp)) out.add("pkg:" + sp.split("/").slice(0, sp.startsWith("@") ? 3 : 2).join("/"));
    }
  }
  /* API base URLs from environment and config files */
  if (/(environ|config|settings|constants|\.env)/i.test(path)) {
    for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?/gi)) {
      const host = m[1].toLowerCase();
      if (!/(localhost|127\.0\.0\.1|example\.|schema|w3\.org|github\.com|googleapis|gstatic|npmjs|unpkg|jsdelivr|cdnjs)/.test(host)) out.add("url:" + host);
    }
  }
  return [...out];
}

/* ============ What the author says: header comment and exported names ============ */
const NOISE_DOC = /(licen[cs]e|copyright|eslint|prettier|@ts-|tslint|jshint|istanbul|biome-ignore|^\s*(src|app)\/[\w./-]+\s*$|generated|do not edit|auto-?generated)/i;
function extractMeta(path, text) {
  const head = text.slice(0, 6000);
  let doc = "";
  if (/\.py$/i.test(path)) { const m = head.match(/^\s*(?:#[^\n]*\n\s*)*(?:"""|\'\'\')([\s\S]*?)(?:"""|\'\'\')/); if (m) doc = m[1]; }
  if (!doc) {
    /* only a header comment (before the first code) or the comment directly above the main export – never comments on single fields */
    const firstCode = head.search(/^(?!\s*(import\b|\/\/|\/\*|\*|$|["']use\b))/m);
    for (const m of head.matchAll(/\/\*\*?([\s\S]*?)\*\/|((?:^[ \t]*\/\/[^\n]*\n){2,})/gm)) {
      const after = head.slice(m.index + m[0].length, m.index + m[0].length + 160);
      const isHeader = firstCode < 0 || m.index < firstCode;
      const isMainExport = /^\s*(@\w+\([\s\S]*?\)\s*)?export\s+(default\s+)?(abstract\s+)?(class|function|async function|const)\b/.test(after) && !/^\s*export\s+(interface|type)\b/.test(after);
      if (!isHeader && !isMainExport) continue;
      const t = (m[1] || m[2] || "").replace(/^[ \t]*(\*|\/\/)[ \t]?/gm, "").replace(/@\w+[^\n]*/g, "").trim();
      if (t.length >= 24 && !NOISE_DOC.test(t)) { doc = t; break; }
    }
  }
  doc = doc.replace(/\s+/g, " ").trim();
  if (doc.length > 260) { const cut = doc.slice(0, 260); doc = (cut.lastIndexOf(". ") > 80 ? cut.slice(0, cut.lastIndexOf(". ") + 1) : cut + "…"); }
  const exp = new Set();
  for (const m of text.matchAll(/^export\s+(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(class|function|const|let|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)) exp.add(m[2]);
  if (/\.py$/i.test(path)) for (const m of text.matchAll(/^(?:class|def)\s+([A-Za-z]\w*)/gm)) if (!m[1].startsWith("_")) exp.add(m[1]);
  const x = [...exp].slice(0, 10);
  return doc || x.length ? { d: doc, x } : null;
}
const ARCH_DOC = /^(architecture|ARCHITECTURE|design|DESIGN)\.md$|^docs?\/(architecture|design|overview|structure|how-it-works)\.md$/i;

/* ============ External services: package name → service ============ */
const EXTERNALS = [
  { id: "auth", label: "Authentication", js: /^(ngx-clerk|@clerk\/|@auth0\/|next-auth|@supabase\/auth|firebase\/auth|@okta\/|keycloak|passport)/, py: /^(authlib|flask_login|django\.contrib\.auth)$/, verb: "authenticates",
    name: sp => /clerk/.test(sp) ? "Clerk" : /auth0/.test(sp) ? "Auth0" : /next-auth/.test(sp) ? "NextAuth" : /okta/.test(sp) ? "Okta" : /keycloak/.test(sp) ? "Keycloak" : /passport/.test(sp) ? "Passport" : "Auth" },
  { id: "http", label: "Backend API", js: /^(@angular\/common\/http|axios|ky|got|node-fetch|ofetch|@tanstack\/react-query|swr|@apollo\/client|graphql-request|@trpc\/client)/, py: /^(requests|httpx|aiohttp|urllib3)$/, verb: "calls", name: () => "HTTP" },
  { id: "db", label: "Database", js: /^(pg|postgres|@neondatabase\/|mysql2?|mongodb|mongoose|@prisma\/client|drizzle-orm|typeorm|sequelize|better-sqlite3|sqlite3|knex|@planetscale\/|@libsql\/)/, py: /^(sqlalchemy|psycopg2?|pymongo|sqlite3|asyncpg|peewee|motor|django\.db)$/, verb: "stores data",
    name: sp => /neon/.test(sp) ? "Neon Postgres" : /(^pg$|postgres|psycopg|asyncpg)/.test(sp) ? "Postgres" : /mongo|motor/.test(sp) ? "MongoDB" : /mysql/.test(sp) ? "MySQL" : /prisma/.test(sp) ? "Prisma ORM" : /drizzle/.test(sp) ? "Drizzle ORM" : /sqlite/.test(sp) ? "SQLite" : "Database" },
  { id: "cache", label: "Cache", js: /^(redis|ioredis|@upstash\/redis|@vercel\/kv)/, py: /^(redis)$/, verb: "caches", name: () => "Redis" },
  { id: "baas", label: "Backend-as-a-Service", js: /^(@supabase\/supabase-js|firebase(\/(app|firestore|database))?$|firebase-admin|appwrite|pocketbase)/, py: /^(supabase|firebase_admin)$/, verb: "syncs",
    name: sp => /supabase/.test(sp) ? "Supabase" : /firebase/.test(sp) ? "Firebase" : /appwrite/.test(sp) ? "Appwrite" : "PocketBase" },
  { id: "ai", label: "AI API", js: /^(openai|@anthropic-ai\/sdk|@google\/generative-ai|@google\/genai|cohere-ai|@mistralai\/|ai$|@ai-sdk\/|replicate)/, py: /^(openai|anthropic|google\.generativeai|cohere|mistralai|transformers|langchain)$/, verb: "prompts",
    name: sp => /openai/.test(sp) ? "OpenAI" : /anthropic/.test(sp) ? "Anthropic" : /google/.test(sp) ? "Gemini" : /mistral/.test(sp) ? "Mistral" : /cohere/.test(sp) ? "Cohere" : /langchain/.test(sp) ? "LangChain" : "AI API" },
  { id: "pay", label: "Payments", js: /^(stripe|@stripe\/|@paypal\/|@lemonsqueezy\/)/, py: /^(stripe)$/, verb: "charges", name: sp => /paypal/.test(sp) ? "PayPal" : /lemon/.test(sp) ? "Lemon Squeezy" : "Stripe" },
  { id: "mail", label: "Email", js: /^(resend|nodemailer|@sendgrid\/|postmark|@react-email\/)/, py: /^(smtplib|sendgrid)$/, verb: "sends email", name: sp => /resend/.test(sp) ? "Resend" : /sendgrid/.test(sp) ? "SendGrid" : /postmark/.test(sp) ? "Postmark" : "Email" },
  { id: "storage", label: "File Storage", js: /^(@aws-sdk\/client-s3|@vercel\/blob|@google-cloud\/storage|minio|uploadthing)/, py: /^(boto3|google\.cloud\.storage|minio)$/, verb: "uploads", name: sp => /vercel/.test(sp) ? "Vercel Blob" : /google/.test(sp) ? "Cloud Storage" : "S3" },
  { id: "realtime", label: "Realtime", js: /^(socket\.io-client|socket\.io|mqtt|ws$|pusher|@pusher\/|ably|@liveblocks\/|partysocket)/, py: /^(paho|websockets|socketio)$/, verb: "streams", name: sp => /mqtt|paho/.test(sp) ? "MQTT-Broker" : /pusher/.test(sp) ? "Pusher" : /liveblocks/.test(sp) ? "Liveblocks" : "WebSocket" },
  { id: "obs", label: "Monitoring", js: /^(@sentry\/|posthog-js|posthog-node|@vercel\/analytics|mixpanel|@datadog\/)/, py: /^(sentry_sdk|posthog)$/, verb: "reports", name: sp => /sentry/.test(sp) ? "Sentry" : /posthog/.test(sp) ? "PostHog" : /vercel/.test(sp) ? "Vercel Analytics" : /mixpanel/.test(sp) ? "Mixpanel" : "Datadog" },
];
function externalFor(spec) {
  const js = spec.startsWith("pkg:"), name = spec.slice(js ? 4 : 3).replace(/^\.+/, "");
  if (!name) return null;
  for (const x of EXTERNALS) if (js ? x.js.test(name) : x.py.test(name.split(".").slice(0, 2).join(".")) || x.py.test(name.split(".")[0])) return { ...x, name: x.name(name) };
  return null;
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

/* ============ Analysis ============ */
const ENTRY_FILE = /(^|\/)(main\.(t|j)sx?|index\.(t|j)sx?|app\.(t|j)sx?|App\.(t|j)sx?|app\.component\.ts|page\.(t|j)sx?|layout\.(t|j)sx?|main\.py|app\.py|manage\.py|server\.(t|j)s|index\.html|main\.go|main\.rs)$/;
function analyze(data) {
  const files = data.files.map(([path, size]) => ({ path, size }));
  const fileSet = new Set(files.map(f => f.path));
  const total = files.reduce((a, f) => a + f.size, 0);

  /* Languages */
  const lang = new Map();
  for (const f of files) { const [n, c] = langOf(f.path); const o = lang.get(n) || { name: n, color: c, bytes: 0, files: 0 }; o.bytes += f.size; o.files++; lang.set(n, o); }
  const langs = [...lang.values()].sort((a, b) => b.bytes - a.bytes);

  /* ===== Deriving the architecture =====
     Goal, as in a good architecture diagram: ~10–16 named components grouped by feature area,
     few labeled relationships, external services and an entry point. */
  /* Source = code that is not a test, not build output and not a config file in the root */
  const isSrc = p => isCode(p) && !isTest(p) && !/(^|\/)(public|static|dist|build|out|vendor|assets|\.next|coverage)\//.test(p) && !/\.min\.js$/.test(p) && !(!p.includes("/") && /\.config\.|^\./.test(p));
  const codeIn = new Map(), allIn = new Map();
  for (const f of files) { const segs = f.path.split("/"); for (let i = 0; i < segs.length; i++) { const d = segs.slice(0, i).join("/"); allIn.set(d, (allIn.get(d) || 0) + 1); if (isSrc(f.path)) codeIn.set(d, (codeIn.get(d) || 0) + 1); } }
  const dirs = [...allIn.keys()];
  const kidsOf = new Map(); for (const d of dirs) if (d) { const p = dirname(d); if (!kidsOf.has(p)) kidsOf.set(p, []); kidsOf.get(p).push(d); }
  const childDirs = d => kidsOf.get(d) || [];
  const directCode = d => files.filter(f => dirname(f.path) === d && isSrc(f.path)).length;
  const totalCode = codeIn.get("") || 0;
  const TARGET = Math.max(8, Math.min(16, Math.round(5 + Math.sqrt(totalCode) * 0.9)));
  /* Start by splitting the root; components are folders, "d/*" stands for the files directly in d */
  let comps = new Set([...childDirs(""), "/*"]);
  const codeOf = c => c.endsWith("/*") ? directCode(c === "/*" ? "" : c.slice(0, -2)) : (codeIn.get(c) || 0);
  const codeComps = () => [...comps].filter(c => codeOf(c) > 0).length;
  const splitResult = c => { const kids = childDirs(c); return [...kids, ...(files.some(f => dirname(f.path) === c) ? [c + "/*"] : [])]; };
  for (let guard = 0; guard < 60; guard++) {
    const cand = [...comps].filter(c => !c.endsWith("/*") && childDirs(c).some(k => codeIn.get(k))).sort((a, b) => codeOf(b) - codeOf(a));
    let done = false;
    for (const c of cand) {
      const res = splitResult(c), add = res.filter(r => (r.endsWith("/*") ? directCode(r.slice(0, -2)) : codeIn.get(r) || 0) > 0).length - 1;
      const share = codeOf(c) / Math.max(1, totalCode);
      const wrapper = /^(src|app|lib|packages|apps|source|main|internal|pkg|modules|crates|services)$/i.test(basename(c)) && add <= 8;
      if (!(wrapper || share > 1 / TARGET)) continue;
      if (codeComps() + add > TARGET && !(wrapper && codeComps() + add <= TARGET + 3)) continue;
      comps.delete(c); res.forEach(r => comps.add(r)); done = true; break;
    }
    if (!done) break;
  }
  /* Assign files (longest matching component) */
  const compList = [...comps];
  const compOf = path => {
    let best = "/*", bl = -1;
    for (const c of compList) {
      const real = c === "/*" ? "" : c.endsWith("/*") ? c.slice(0, -2) : c;
      const hit = c.endsWith("/*") ? dirname(path) === real : path.startsWith(real + "/");
      if (hit && real.length > bl) { best = c; bl = real.length; }
    }
    return best;
  };
  const compMap = new Map(), fileComp = new Map();
  /* Tool folders without source code (.vscode, .idea …) belong to the project root */
  const INFRA_DOT = /^\.(github|gitlab|circleci|githooks|devcontainer|husky)$/;
  const foldIntoRoot = k => k !== "/*" && !k.includes("/") && k.startsWith(".") && !INFRA_DOT.test(k) && !codeIn.get(k);
  for (const f of files) { let k = compOf(f.path); if (foldIntoRoot(k)) k = "/*"; if (!compMap.has(k)) compMap.set(k, { key: k, files: [], bytes: 0 }); const o = compMap.get(k); o.files.push(f); o.bytes += f.size; fileComp.set(f.path, k); }
  const aliasRoot = fileSet.has("tsconfig.json") && files.some(f => f.path.startsWith("src/")) ? "src" : "";

  /* Key files as their own nodes (e.g. todo.ts, toast.service.ts, plan.model.ts):
     service, store or model files that many other files import – especially files from other components. */
  const importers = new Map();
  for (const [from, specs] of Object.entries(data.imports || {})) {
    if (!fileSet.has(from) || isTest(from)) continue;
    for (const sp of specs) {
      if (sp.startsWith("pkg:") || sp.startsWith("url:")) continue;
      const to = resolveImport(from, sp, fileSet, aliasRoot); if (!to || to === from) continue;
      if (!importers.has(to)) importers.set(to, new Set()); importers.get(to).add(from);
    }
  }
  const SERVICE_FILE = /\.(service|store|model|api|client|repository|repo|context|provider|gateway|facade|state)\.(m?[jt]sx?|py)$|^use[A-Z]\w*\.(t|j)sx?$|_(service|repository|client|store)\.py$/;
  const SERVICE_DIR = /^(services?|stores?|state|api|lib|core|data|repositories|models?|hooks|providers|context|clients?|domain)$/i;
  const promoted = [];
  for (const [path, from] of importers) {
    const comp = fileComp.get(path); if (!comp || comp === "/*" || !isSrc(path) || ENTRY_FILE.test(path)) continue;
    const named = SERVICE_FILE.test(basename(path)) || SERVICE_DIR.test(basename(dirname(path)));
    if (!named) continue;
    const cross = [...from].filter(f => fileComp.get(f) !== comp).length;
    const size = files.find(f => f.path === path)?.size || 0;
    if ((cross < 2 && from.size < 4) || size < 1500) continue;
    promoted.push({ path, comp, score: cross * 2 + from.size + Math.min(4, size / 8000), cross });
  }
  const codeComps0 = [...compMap.values()].filter(c => c.files.some(f => isSrc(f.path))).length;
  const BUDGET = Math.max(2, Math.min(7, Math.round(codeComps0 * 0.45)));
  const perComp = new Map(); let taken = 0;
  for (const c of promoted.sort((a, b) => b.score - a.score)) {
    if (taken >= BUDGET) break;
    const host = compMap.get(c.comp); const srcLeft = host.files.filter(f => isSrc(f.path) && f.path !== c.path).length;
    if (srcLeft < 2 || (perComp.get(c.comp) || 0) >= 2) continue; /* the folder must keep something of its own */
    const f = host.files.find(x => x.path === c.path);
    host.files = host.files.filter(x => x !== f); host.bytes -= f.size;
    const key = "f:" + c.path;
    compMap.set(key, { key, files: [f], bytes: f.size, parentKey: c.comp });
    fileComp.set(c.path, key); perComp.set(c.comp, (perComp.get(c.comp) || 0) + 1); taken++;
  }

  /* Names: generic folder names get their feature area prepended ("todo/services" → "Todo Services") */
  const GENERIC = /^(components?|services?|shared|common|models?|utils?|helpers|lib|libs|hooks|store|stores|state|types|api|routes?|controllers?|views?|pages|core|data|features|modules|ui|widgets|handlers?|middleware|schemas?|entities|interfaces|directives|pipes|guards|interceptors|providers|config|constants|assets)$/i;
  const human = s => s.replace(/[-_.]+/g, " ").replace(/\b\w/g, ch => ch.toUpperCase()).trim();
  const ENTRY = ENTRY_FILE;
  const mainFile = fs => {
    const src = fs.filter(f => isSrc(f.path)); if (!src.length) return null;
    const roots = new Set(src.map(f => dirname(f.path)).sort((x, y) => x.length - y.length).slice(0, 1));
    const entry = src.find(f => ENTRY.test(f.path) && roots.has(dirname(f.path)));
    if (entry) return entry;
    const svc = src.filter(f => /\.(service|store|model|api|client|controller|router|module|hook)\.|^use[A-Z]/.test(basename(f.path)));
    return (svc.length ? svc : src).sort((a, b) => b.size - a.size)[0];
  };
  const STRIP = /^(src|app|lib|source|frontend|client|main|java|kotlin)$/i;
  const domainOf = real => { const segs = real.split("/").filter(Boolean); let i = 0; while (i < segs.length - 1 && STRIP.test(segs[i])) i++; return segs.length ? segs[i] : ""; };
  const FILE_KIND = { service: "Service", store: "Store", model: "Model", api: "API", client: "Client", repository: "Repository", repo: "Repository", context: "Context", provider: "Provider", gateway: "Gateway", facade: "Facade", state: "State" };
  const DIR_KIND = { services: "Service", service: "Service", stores: "Store", store: "Store", state: "State", api: "API", models: "Model", model: "Model", repositories: "Repository", clients: "Client", client: "Client" };
  const fileLabel = path => {
    const b = basename(path).replace(/\.(m?[jt]sx?|py)$/, "");
    if (/^use[A-Z]/.test(b)) return b;
    if (/^use[-_]/.test(b)) return "use" + b.slice(4).replace(/(^|[-_])(\w)/g, (_, __, ch) => ch.toUpperCase());
    const m = b.match(/^(.*?)[._-](service|store|model|api|client|repository|repo|context|provider|gateway|facade|state)$/i);
    if (m) return human(m[1]) + " " + FILE_KIND[m[2].toLowerCase()];
    const dk = DIR_KIND[basename(dirname(path)).toLowerCase()];
    return human(b) + (dk ? " " + dk : "");
  };
  let nodes = [...compMap.values()].map((c, i) => {
    if (c.key.startsWith("f:")) {
      const path = c.key.slice(2);
      return { id: "n" + i, key: c.key, path, label: fileLabel(path), cat: /[._-]model\.|[._-]types?\.|(^|\/)models?\//.test(path) ? "core" : categorize(dirname(path)) === "frontend" && SERVICE_FILE.test(basename(path)) ? "backend" : categorize(dirname(path)), files: c.files, bytes: c.bytes, main: basename(path), code: 1, isDir: false, domain: domainOf(path), kind: "comp", file: true, parentKey: c.parentKey };
    }
    const real = c.key === "/*" ? "" : c.key.endsWith("/*") ? c.key.slice(0, -2) : c.key;
    const base = basename(real), parent = basename(dirname(real));
    const mf = mainFile(c.files);
    let label;
    if (c.key === "/*") label = "Project Root";
    else if (c.key.endsWith("/*")) label = mf && ENTRY.test(mf.path) ? (/(^|\/)(app|App)\./.test(mf.path) ? "App Shell" : "Entry Point") : mf && /\.(config|routes?)\./.test(mf.path) ? human(basename(mf.path).replace(/\.(m?[jt]sx?|py|go|rs|vue|svelte)$/, "")) : STRIP.test(base) && mf ? human(basename(mf.path).replace(/\.(m?[jt]sx?|py|go|rs|vue|svelte)$/, "")) : human(base) + (GENERIC.test(base) ? "" : " Logic");
    else if (GENERIC.test(base) && parent && !STRIP.test(parent)) label = human(parent) + " " + human(base);
    else label = human(base);
    const testShare = c.files.filter(f => isTest(f.path)).length / Math.max(1, c.files.length);
    const mdShare = c.files.filter(f => /\.(mdx?|txt|rst)$/i.test(f.path)).length / Math.max(1, c.files.length);
    const codeCnt = c.files.filter(f => isSrc(f.path)).length;
    let cat = c.key === "/*" ? "config" : testShare > 0.6 ? "tests" : !codeCnt && mdShare > 0.5 ? "docs" : categorize(real);
    if (c.key.endsWith("/*") && c.key !== "/*" && mf && ENTRY.test(mf.path)) cat = "frontend";
    return { id: "n" + i, key: c.key, path: real, label, cat, files: c.files, bytes: c.bytes, main: mf ? basename(mf.path) : null, code: c.files.filter(f => isSrc(f.path)).length, isDir: !c.key.endsWith("/*"), domain: domainOf(real), kind: "comp" };
  });
  /* Pure config/routing components (e.g. app.config.ts, app.routes.ts) belong to the app shell */
  const shellNode = nodes.find(n => n.label === "App Shell");
  if (shellNode) nodes = nodes.filter(n => {
    if (n === shellNode || n.kind !== "comp") return true;
    const src = n.files.filter(f => isSrc(f.path));
    if (!src.length || src.length > 3 || !src.every(f => /\.(config|routes?|providers?)\.(m?[jt]sx?)$/.test(f.path))) return true;
    if (!(n.path === shellNode.path || dirname(n.path) === shellNode.path || dirname(shellNode.path) === n.path || n.path.startsWith(shellNode.path + "/"))) return true;
    shellNode.files.push(...n.files); shellNode.bytes += n.bytes; shellNode.code += src.length; n.files.forEach(f => fileComp.set(f.path, shellNode.key));
    return false;
  });
  /* Make duplicate labels unique */
  const seen = new Map(); nodes.forEach(n => seen.set(n.label, (seen.get(n.label) || 0) + 1));
  nodes.forEach(n => { if (seen.get(n.label) > 1 && n.path) n.label = human(n.path.split("/").filter(x => !STRIP.test(x)).slice(-2).join(" ")) || n.label; });
  /* Groups: feature area with ≥ 2 components, otherwise the layer */
  const domCount = new Map(); nodes.forEach(n => { if (n.domain && n.code) domCount.set(n.domain, (domCount.get(n.domain) || 0) + 1); });
  nodes.forEach(n => { n.group = n.domain && domCount.get(n.domain) >= 2 && n.code ? human(n.domain) : CATS[n.cat].label; });
  const nodeByKey = new Map(nodes.map(n => [n.key, n]));
  nodes.forEach(n => { if (n.file) { const p = nodeByKey.get(n.parentKey); n.parentId = p?.id; n.parentLabel = p?.label; if (p) n.group = p.group; } });

  /* Relationships from imports */
  const edgeW = new Map(), extUse = new Map(), urlHosts = new Set(); const fileEdges = [];
  let resolved = 0, analysed = 0;
  for (const [from, specs] of Object.entries(data.imports || {})) {
    if (!fileSet.has(from)) continue; analysed++;
    const testFile = isTest(from); const a = nodeByKey.get(fileComp.get(from));
    for (const sp of specs) {
      if (sp.startsWith("url:")) { urlHosts.add(sp.slice(4)); continue; }
      if (sp.startsWith("pkg:") || sp.startsWith("py:")) {
        const to = sp.startsWith("py:") ? resolveImport(from, sp, fileSet, aliasRoot) : null;
        if (!to) { if (testFile || !a) continue; const x = externalFor(sp); if (x) { const k = x.id; if (!extUse.has(k)) extUse.set(k, { x, from: new Map() }); const u = extUse.get(k); u.from.set(a.id, (u.from.get(a.id) || 0) + 1); } continue; }
        resolved++; fileEdges.push([from, to]);
        if (testFile || isTest(to)) continue;
        const b = nodeByKey.get(fileComp.get(to)); if (!a || !b || a === b) continue;
        const k = a.id + ">" + b.id; edgeW.set(k, (edgeW.get(k) || 0) + 1); continue;
      }
      const to = resolveImport(from, sp, fileSet, aliasRoot); if (!to) continue; resolved++;
      fileEdges.push([from, to]);
      if (testFile || isTest(to)) continue;
      const b = nodeByKey.get(fileComp.get(to));
      if (!a || !b || a === b) continue;
      const k = a.id + ">" + b.id; edgeW.set(k, (edgeW.get(k) || 0) + 1);
    }
  }
  const allEdges = [...edgeW.entries()].map(([k, w]) => { const [from, to] = k.split(">"); return { from, to, w }; }).sort((x, y) => y.w - x.w);

  /* External services as their own nodes */
  const realHosts = [...urlHosts].filter(h => !/(googleapis|gstatic|fonts|cdn)/.test(h));
  extUse.forEach(({ x, from }, k) => {
    const id = "x_" + k;
    let label = x.name;
    if (x.id === "http") label = realHosts.length ? "API · " + realHosts[0] : "Backend API";
    else if (x.name !== x.label) label = x.name;
    nodes.push({ id, key: id, path: "", label, cat: "external", files: [], bytes: 0, main: x.label, code: 0, isDir: false, domain: "", kind: "ext", group: CATS.external.label, verb: x.verb });
    from.forEach((w, fid) => allEdges.push({ from: fid, to: id, w, ext: true }));
  });
  /* User → entry point (only for projects with a UI) */
  const hasUi = files.some(f => /\.(html|tsx|jsx|vue|svelte|astro)$/.test(f.path) && !isTest(f.path));
  const SIDE = new Set(["tooling", "tests", "infra", "docs"]);
  const entryNode = nodes.filter(n => n.kind === "comp" && !SIDE.has(n.cat) && n.files.some(f => ENTRY.test(f.path) && isSrc(f.path)))
    .sort((x, y) => ((y.cat === "frontend") - (x.cat === "frontend")) || (x.path.split("/").length - y.path.split("/").length) || (y.code - x.code))[0];
  if (hasUi && entryNode) {
    /* prefer the app shell that pulls in the most other components */
    const outDeg = id => allEdges.filter(e => e.from === id && !e.ext).length;
    const shell = nodes.filter(n => n.kind === "comp" && !SIDE.has(n.cat) && /App Shell|Entry Point/.test(n.label)).sort((x, y) => outDeg(y.id) - outDeg(x.id))[0] || entryNode;
    nodes.push({ id: "u_user", key: "u_user", path: "", label: "User", cat: "user", files: [], bytes: 0, main: null, code: 0, isDir: false, domain: "", kind: "user", group: "" });
    allEdges.push({ from: "u_user", to: shell.id, w: 0, user: true });
  }

  /* Thin out relationships: the strongest per source plus all clearly strong ones; verb chosen by target */
  const DEV_INFRA = /^(scripts?|bin|tools|\.github|\.githooks|\.gitlab|\.circleci|ci|\.devcontainer|\.husky|\.vscode)$/i;
  nodes.forEach(n => { n.side = n.kind === "comp" && (SIDE.has(n.cat) && !(n.cat === "infra" && !DEV_INFRA.test(basename(n.path))) || n.cat === "config" || (n.code === 0 && n.cat !== "frontend")); });
  const byId = new Map(nodes.map(n => [n.id, n]));
  const internalAll = allEdges.filter(e => !e.ext && !e.user && byId.get(e.from).cat !== "config" && byId.get(e.to).cat !== "config");
  /* Thin runtime relationships and side areas separately so tooling does not use up the budget */
  const isSideEdge = e => byId.get(e.from).side || byId.get(e.to).side;
  const internal = internalAll.filter(e => !isSideEdge(e));
  const maxW = Math.max(1, ...internal.map(e => e.w));
  const keep = new Set();
  const bySrc = new Map(); internal.forEach(e => { if (!bySrc.has(e.from)) bySrc.set(e.from, []); bySrc.get(e.from).push(e); });
  bySrc.forEach(list => list.sort((x, y) => y.w - x.w).slice(0, 2).forEach(e => keep.add(e)));
  internal.forEach(e => { if (e.w >= maxW * 0.35) keep.add(e); });
  const compCount = nodes.filter(n => n.kind === "comp" && n.code).length;
  let edges = [...keep].sort((x, y) => y.w - x.w).slice(0, Math.round(compCount * 1.4));
  /* Remove transitive shortcuts: drop a→c when a→b→c exists and a→c is weak */
  const has2 = (x, y) => edges.some(e => e.from === x && e.to === y);
  edges = edges.filter(e => !(e.w <= 2 && edges.some(m => m.from === e.from && m.to !== e.to && has2(m.to, e.to) && m.w >= e.w)));
  /* Every runtime component keeps its strongest incoming arrow – otherwise it looks like a loose root */
  nodes.filter(n => n.kind === "comp" && !n.side).forEach(n => {
    if (edges.some(e => e.to === n.id)) return;
    const best = internal.filter(e => e.to === n.id).sort((x, y) => y.w - x.w)[0]; if (best) edges.push(best);
  });
  /* Config targets (environment, config) get at most two arrows */
  const isCfg = id => /environ|config|settings|constants/i.test(byId.get(id).path);
  const cfgIn = new Map(); edges.filter(e => isCfg(e.to)).sort((x, y) => y.w - x.w).forEach(e => cfgIn.set(e.to, [...(cfgIn.get(e.to) || []), e]));
  cfgIn.forEach(list => list.slice(2).forEach(e => { edges = edges.filter(x => x !== e); }));
  /* Single imports are dropped when both ends are connected anyway */
  const deg = id => edges.filter(e => e.from === id || e.to === id).length;
  edges = edges.filter(e => !(e.w === 1 && deg(e.from) > 1 && deg(e.to) > 1 && edges.some(x => x.to === e.to && x !== e)));
  /* The shell is the backbone: every view it pulls in stays visible */
  const shellId = allEdges.find(e => e.user)?.to;
  if (shellId) internal.filter(e => e.from === shellId && !edges.includes(e) && byId.get(e.to).cat === "frontend").sort((x, y) => y.w - x.w).slice(0, 8).forEach(e => edges.push(e));
  const sideBySrc = new Map(); internalAll.filter(isSideEdge).forEach(e => { if (!sideBySrc.has(e.from)) sideBySrc.set(e.from, []); sideBySrc.get(e.from).push(e); });
  sideBySrc.forEach(list => edges.push(...list.sort((x, y) => y.w - x.w).slice(0, 2)));
  /* External services: only the two components that use them most */
  const extBy = new Map(); allEdges.filter(e => e.ext).forEach(e => { if (!extBy.has(e.to)) extBy.set(e.to, []); extBy.get(e.to).push(e); });
  const side = e => (SIDE.has(byId.get(e.from).cat) ? 1 : 0);
  extBy.forEach(list => { const l = list.sort((x, y) => side(x) - side(y) || y.w - x.w); edges.push(l[0], ...l.slice(1, 2).filter(e => e.w >= Math.max(2, l[0].w / 3))); });
  edges.push(...allEdges.filter(e => e.user));
  const verb = (e) => {
    if (e.user) return "uses";
    const t = byId.get(e.to);
    if (e.ext) return t.verb || "uses";
    if (/model|types?|entities|schema/i.test(t.path)) return "uses model";
    if (t.cat === "backend" || /services?|store|state|api/i.test(basename(t.path)) || /\.(service|store|api|client)\./.test(t.main || "")) return "calls";
    if (t.cat === "frontend") return /Shell|Entry/.test(byId.get(e.from).label) ? "shows" : "renders";
    if (t.cat === "config" || /environ|config/i.test(t.path)) return "reads config";
    return "uses";
  };
  edges.forEach(e => { e.verb = verb(e); });
  allEdges.forEach(e => { if (!e.verb) e.verb = verb(e); });
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
    { t: "README", s: has(/^readme(\.\w+)?$/i) ? "ok" : "bad", w: has(/^readme(\.\w+)?$/i) ? "Present in the root directory" : "No README in the root directory" },
    { t: "License", s: has(/^(licen[cs]e|copying)(\.\w+)?$/i) ? "ok" : "warn", w: has(/^(licen[cs]e|copying)(\.\w+)?$/i) ? "License file found" : "Without a license, reuse is legally unclear" },
    { t: "Continuous Integration", s: has(/^(\.github\/workflows\/|\.gitlab-ci\.yml|\.circleci\/|azure-pipelines\.yml|Jenkinsfile|\.buildkite\/)/) ? "ok" : "warn", w: (() => { const n = files.filter(f => /^\.github\/workflows\//.test(f.path)).length; return n ? n + " GitHub workflow" + (n > 1 ? "s" : "") : has(/^(\.gitlab-ci\.yml|\.circleci\/|azure-pipelines\.yml|Jenkinsfile)/) ? "CI configuration found" : "No CI pipeline detected"; })() },
    { t: "Tests", s: tests.length === 0 ? "bad" : ratio < 0.08 ? "warn" : "ok", w: tests.length === 0 ? "No test files detected" : `${fmtInt(tests.length)} test files for ${fmtInt(src)} source files (${(ratio * 100).toFixed(0)}%)` },
    { t: "Documentation", s: has(/^docs?\//i) || mdCount > 4 ? "ok" : "warn", w: `${mdCount} Markdown file${mdCount === 1 ? "" : "s"}${has(/^docs?\//i) ? ", dedicated docs folder" : ""}` },
    { t: "Reproducible dependencies", s: has(/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|poetry\.lock|uv\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/) ? "ok" : (has(/(^|\/)(package\.json|pyproject\.toml|Cargo\.toml|go\.mod)$/) ? "warn" : "na"), w: has(/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|poetry\.lock|uv\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/) ? "Lockfile committed" : "No lockfile found" },
    { t: "Code quality (lint/format)", s: has(/(^|\/)(\.eslintrc[^/]*|eslint\.config\.[cm]?js|\.prettierrc[^/]*|prettier\.config\.[cm]?js|biome\.jsonc?|ruff\.toml|\.flake8|\.editorconfig|\.golangci\.ya?ml|rustfmt\.toml|\.rubocop\.yml)$/) ? "ok" : "warn", w: has(/(^|\/)(\.eslintrc[^/]*|eslint\.config\.[cm]?js|\.prettierrc[^/]*|prettier\.config\.[cm]?js|biome\.jsonc?|ruff\.toml|\.flake8|\.editorconfig|\.golangci\.ya?ml|rustfmt\.toml|\.rubocop\.yml)$/) ? "Linter or formatter config present" : "No lint/format config detected" },
    { t: "Container / Deployment", s: has(/(^|\/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|compose\.ya?ml|wrangler[^/]*\.(toml|jsonc?)|vercel\.json|netlify\.toml|fly\.toml|railway\.json|Procfile)$/) ? "ok" : "na", w: has(/(^|\/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|compose\.ya?ml|wrangler[^/]*\.(toml|jsonc?)|vercel\.json|netlify\.toml|fly\.toml|railway\.json|Procfile)$/) ? "Deployment config found" : "No deployment config" },
    { t: "Secrets", s: envCommitted.length ? "bad" : "ok", w: envCommitted.length ? envCommitted.map(f => f.path).join(", ") + " is committed" : has(/\.env\.(example|sample|template)$/) ? "Only an .env template is committed" : "No .env file committed" },
    { t: "Large files", s: big.length ? "warn" : "ok", w: big.length ? big.length + " file(s) over 1 MB, e.g. " + big[0].path : "No non-media file over 1 MB" },
  ];
  const scored = checks.filter(c => c.s !== "na");
  const score = Math.round(scored.reduce((a, c) => a + (c.s === "ok" ? 1 : c.s === "warn" ? 0.5 : 0), 0) / Math.max(1, scored.length) * 100);

  return { compCount, files, fileSet, total, langs, nodes, edges, allEdges, fileEdges, fileComp, nodeByKey, stack: STACK, checks, score, code: code.length, tests: tests.length, analysed, resolved };
}

/* ============ Compiling to Mermaid ============ */
function esc(s) { return String(s).replace(/[&]/g, "and").replace(/"/g, "#quot;").replace(/</g, "#lt;").replace(/>/g, "#gt;").replace(/#(?!quot;|lt;|gt;)/g, "#35;").replace(/[\[\]{}|]/g, " "); }
function mixHex(a, b, t) { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const x = p(a), y = p(b); return "#" + x.map((v, i) => Math.round(v * t + y[i] * (1 - t)).toString(16).padStart(2, "0")).join(""); }
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
      const sub = n.main ? `<br/><small>${esc(n.main)}</small>` : n.sub ? `<br/><small>${esc(n.sub)}</small>` : "";
      const shape = n.cat === "user" ? [`(("`, `"))`] : n.cat === "external" ? [`[("`, `")]`] : n.cat === "config" ? [`[/"`, `"/]`] : [`["`, `"]`];
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
    L.push(`  classDef ${c} fill:${mixHex(solid("--c-" + c), solid("--surface"), 0.16)},stroke:${solid("--c-" + c)},stroke-width:1.5px,color:${solid("--text")}`);
    const ids = ast.nodes.filter(n => n.cat === c).map(n => n.id);
    if (ids.length) L.push(`  class ${ids.join(",")} ${c}`);
  }
  return L.join("\n");
}
function heuristicAst(A) {
  const linked = new Set(A.edges.flatMap(e => [e.from, e.to]));
  const nodes = A.nodes.filter(n => n.files.length > 0 || n.kind !== "comp").map(n => ({
    id: n.id, label: n.label, cat: n.cat, path: n.path, isDir: n.isDir, group: n.group, kind: n.kind, main: n.main, side: n.side, count: n.files.length, file: n.file, parentId: n.parentId, parentLabel: n.parentLabel,
    sub: n.kind === "comp" ? `${fmtInt(n.files.length)} files · ${fmtBytes(n.bytes)}` : "", linked: linked.has(n.id),
  }));
  return { nodes, edges: A.edges.map(e => ({ from: e.from, to: e.to, w: e.w, label: e.verb })) };
}


/* ============ Loading: GitHub ============ */
function parseRepo(s) {
  s = s.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const m = s.match(/(?:github\.com[/:])?([\w.-]+)\/([\w.-]+)(?:\/tree\/([^?#]+))?/);
  return m ? { owner: m[1], repo: m[2], ref: m[3] } : null;
}
async function gh(path, token, accept = "application/vnd.github+json") {
  const r = await fetch("https://api.github.com" + path, { headers: { Accept: accept, ...(token ? { Authorization: "Bearer " + token } : {}) } });
  if (!r.ok) { const e = new Error(r.status === 404 ? "Repository not found or private (add a token)." : r.status === 403 || r.status === 429 ? "GitHub rate limit reached. Try again with a token or later." : "GitHub responded with " + r.status); e.status = r.status; throw e; }
  return accept.includes("raw") ? r.text() : r.json();
}
async function loadGitHub(input) {
  const p = parseRepo(input); if (!p) throw new Error("Enter owner/repo or a GitHub URL.");
  const token = $("#tokenInput").value.trim();
  logStart();
  let s = logStep(`Fetching repository ${p.owner}/${p.repo} …`);
  let meta;
  try { meta = await gh(`/repos/${p.owner}/${p.repo}`, token); }
  catch (e) { if (e instanceof TypeError) throw new Error("Network access to GitHub is blocked in this view. Open index.html locally in your browser or use “Folder”."); throw e; }
  const branch = p.ref || meta.default_branch; logDone(s, `Repository found · branch ${branch} · ★ ${fmtInt(meta.stargazers_count || 0)}`);
  s = logStep("Loading file tree …");
  const tree = await gh(`/repos/${p.owner}/${p.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, token);
  const files = tree.tree.filter(t => t.type === "blob" && !t.path.split("/").some(x => IGNORE_DIRS.has(x))).map(t => [t.path, t.size || 0]);
  logDone(s, `${fmtInt(files.length)} files${tree.truncated ? " (truncated by GitHub)" : ""}`);
  const raw = async path => token
    ? gh(`/repos/${p.owner}/${p.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`, token, "application/vnd.github.raw")
    : fetch(`https://raw.githubusercontent.com/${p.owner}/${p.repo}/${encodeURIComponent(branch)}/${path.split("/").map(encodeURIComponent).join("/")}`).then(r => r.ok ? r.text() : "");
  s = logStep("Reading README and manifests …");
  const readmePath = files.find(f => /^readme(\.md|\.rst|\.txt)?$/i.test(f[0]))?.[0];
  const readme = readmePath ? (await raw(readmePath).catch(() => "")).slice(0, 12000) : "";
  const archPath = files.find(f => ARCH_DOC.test(f[0]))?.[0];
  const archDoc = archPath ? { path: archPath, text: (await raw(archPath).catch(() => "")).slice(0, 8000) } : null;
  const deps = [];
  for (const mf of files.filter(f => /(^|\/)package\.json$/.test(f[0])).slice(0, 4)) {
    try { const pj = JSON.parse(await raw(mf[0])); deps.push(...Object.keys(pj.dependencies || {}), ...Object.keys(pj.devDependencies || {})); } catch {}
  }
  const req = files.find(f => /(^|\/)requirements\.txt$/.test(f[0]));
  if (req) { try { (await raw(req[0])).split("\n").forEach(l => { const m = l.trim().match(/^([A-Za-z0-9_.-]+)/); if (m && !l.startsWith("#")) deps.push(m[1].toLowerCase()); }); } catch {} }
  logDone(s, `README ${readme ? "read" : "missing"} · ${deps.length} dependencies`);
  /* Source sample: spread evenly across top-level folders (bounded excerpts, as GitDiagram does) */
  const cand = files.filter(f => isImportable(f[0]) && !isTest(f[0]) && f[1] < 200000);
  const buckets = new Map(); cand.forEach(f => { const k = f[0].split("/").slice(0, 2).join("/"); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(f); });
  const pick = []; const LIMIT = token ? 160 : 220; let round = 0;
  const bl = [...buckets.values()]; bl.forEach(b => b.sort((a, c) => c[1] - a[1]));
  while (pick.length < LIMIT && bl.some(b => b.length > round)) { for (const b of bl) if (b[round] && pick.length < LIMIT) pick.push(b[round]); round++; }
  s = logStep(`Reading source: 0 / ${pick.length}`);
  const imports = {}, fileMeta = {}; let done = 0;
  const queue = [...pick];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) { const f = queue.shift(); try { const t = await raw(f[0]); const sp = extractImports(f[0], t); if (sp.length) imports[f[0]] = sp; const mt = extractMeta(f[0], t); if (mt) fileMeta[f[0]] = mt; } catch {} done++; s.lastChild.textContent = `Reading source: ${done} / ${pick.length}`; }
  }));
  logDone(s, `${pick.length} source files read, ${Object.keys(imports).length} with imports`);
  return { source: "github", repo: `${p.owner}/${p.repo}`, branch, description: meta.description, files, imports, readme, deps, truncated: tree.truncated, meta: fileMeta, archDoc };
}

/* ============ Loading: local folder ============ */
async function loadLocal(fileList) {
  const all = [...fileList]; if (!all.length) throw new Error("The folder is empty.");
  logStart();
  const rootName = (all[0].webkitRelativePath || all[0].name).split("/")[0];
  const items = all.map(f => ({ f, path: (f.webkitRelativePath || f.name).split("/").slice(1).join("/") }))
    .filter(x => x.path && !x.path.split("/").some(s => IGNORE_DIRS.has(s)));
  let s = logStep(`${fmtInt(items.length)} files collected from “${rootName}”`); logDone(s);
  const files = items.map(x => [x.path, x.f.size]);
  const imports = {}, fileMeta = {}; let readme = "", deps = [];
  const src = items.filter(x => isImportable(x.path) && x.f.size < 400000).slice(0, 4000);
  s = logStep(`Analyzing imports: 0 / ${src.length}`);
  let i = 0;
  for (const x of src) { const txt = await x.f.text(); const sp = extractImports(x.path, txt); if (sp.length) imports[x.path] = sp; const mt = extractMeta(x.path, txt); if (mt) fileMeta[x.path] = mt; if (++i % 50 === 0) s.lastChild.textContent = `Analyzing imports: ${i} / ${src.length}`; }
  logDone(s, `${src.length} source files analyzed`);
  const rd = items.find(x => /^readme(\.md|\.rst|\.txt)?$/i.test(x.path)); if (rd) readme = (await rd.f.text()).slice(0, 12000);
  const ad = items.find(x => ARCH_DOC.test(x.path)); const archDoc = ad ? { path: ad.path, text: (await ad.f.text()).slice(0, 8000) } : null;
  for (const x of items.filter(x => /(^|\/)package\.json$/.test(x.path)).slice(0, 6)) { try { const pj = JSON.parse(await x.f.text()); deps.push(...Object.keys(pj.dependencies || {}), ...Object.keys(pj.devDependencies || {})); } catch {} }
  const rq = items.find(x => /(^|\/)requirements\.txt$/.test(x.path)); if (rq) (await rq.f.text()).split("\n").forEach(l => { const m = l.trim().match(/^([A-Za-z0-9_.-]+)/); if (m && !l.startsWith("#")) deps.push(m[1].toLowerCase()); });
  return { source: "local", repo: rootName, branch: "", files, imports, readme, deps, meta: fileMeta, archDoc };
}

