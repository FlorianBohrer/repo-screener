# Repo Screener

A screener and visualizer for code projects. It runs entirely in the browser with no server and can be hosted as a static page (e.g. on Vercel).

## What it does

1. **Load:** default branch, recursive file tree and README via the GitHub API, or a local folder that never leaves your browser.
2. **Source sample:** up to 220 source files (JS/TS/Python), spread evenly across folders. Imports are extracted and resolved, including the `@/` alias, `index` files and relative Python imports.
3. **Components:** folders are split adaptively into roughly 8 to 16 components. Wrappers like `src/` or `app/` are unwrapped, large feature areas like `todo/` are split into components, services, shared and model. Each component gets a readable name (e.g. "Todo Services") and its most important file as a subtitle.
4. **Key files as their own nodes:** service, store, model and hook files that many other files import (especially from other components) get their own card, e.g. "Todo Service" (`todo.ts`) or "Toast Service" (`toast.service.ts`). Between 2 and 7 per project depending on size, at most 2 per folder. File cards show a file icon and a colored edge; "Part of" in the panel leads back to the folder.
5. **External services and entry point:** package imports are mapped to known services such as Clerk, Supabase, Postgres, Redis, Stripe, OpenAI, S3, Sentry or HTTP APIs (with the host taken from environment files). A user node points to the app shell.
6. **Relationships:** each component keeps only its strongest dependencies, but always its strongest incoming arrow. Weak shortcuts through an intermediate component are dropped. Every relationship carries a verb ("calls", "uses", "authenticates", "reads config" …); the import count is shown in the detail panel and on hover.
7. **Architecture canvas:** laid out with dagre. The direction is chosen automatically: both top-to-bottom and left-to-right are computed and the one that fits the screen larger wins (or pick ↓ / → yourself). User → app shell → views → feature logic → core → external services in the last row. Lines run at right angles with rounded corners, each with its own anchor point on the card edge, and parallel cross segments get separate lanes. Tooling, tests, docs and developer infrastructure are hidden by default and can be shown with "Tooling & Tests". Components without connections appear as small chips below.

Also:

- **Screening:** 10 checks with a score: README, license, CI, test ratio, docs, lockfile, lint/format, deployment, committed `.env`, large files.
- **Stack detection** from config files and `package.json`/`requirements.txt`.
- **Treemap:** area = file size, color = language, click to zoom in.
- Filterable **file tree**.
- **Export** of the diagram as Mermaid source.

## Usage

| Action | Input |
|---|---|
| Pan the canvas | Drag (with momentum) or scroll |
| Zoom | ⌘/Ctrl + scroll, `+` / `−`, or the buttons bottom left |
| Fit to screen | `F` or the fit button |
| Preview connections | Hover a card |
| Open a component | Click a card |
| Inspect a relationship | Hover a line; click jumps to its source |
| Highlight a category | Hover a legend entry |
| Close the panel | ✕, `Esc` or swipe it to the right |
| Focus the search | `/` or ⌘/Ctrl + K |

Add `?repo=owner/repo` to the URL to analyze a repo directly.

Without a token, GitHub allows 60 API calls per hour. One analysis needs only 2 API calls; source files are fetched from raw.githubusercontent.com. For private repos, enter a token via the key icon. It is kept in memory only.

## Development

```bash
python3 build.py
```

This produces `public/index.html`, which can be opened directly in a browser.

| File | Purpose |
|---|---|
| `src/ui-head.html` | Styles and markup |
| `src/core.js` | Analysis: languages, components, imports, stack, screening, loaders |
| `src/ui.js` | UI: canvas, spring animations, panel, treemap, files, screening |
| `src/sample.json` | Example data (file tree and imports of a public repo) |
| `build.py` | Assembles everything into one page |
| `vercel.json` | Build config for Vercel |

Libraries: d3 7.9.0 and dagre 0.8.5 (both from cdnjs).

## Deploying to Vercel

Import the repo in Vercel. Build command and output directory come from `vercel.json`.
