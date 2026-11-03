"""Baut den Repo-Screener.

Setzt Oberfläche, Logik und Beispieldaten zu einer einzigen statischen Seite zusammen:
  public/index.html  – eigenständige Seite (wird auf Vercel ausgeliefert)
Optionale Erweiterungen in src/ext/ (*.html vor die Seite, *.js als Skript) ergeben zusätzlich  artifact.html.
"""
import json, pathlib

root = pathlib.Path(__file__).parent
src = root / "src"
head = (src / "ui-head.html").read_text(encoding="utf-8")
sample = json.dumps(json.loads((src / "sample.json").read_text(encoding="utf-8")), separators=(",", ":")).replace("</", "<\\/")
code = "\n".join((src / f).read_text(encoding="utf-8") for f in ("core.js", "explain.js", "ui.js"))
libs = ('<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>\n'
        '<script src="https://cdnjs.cloudflare.com/ajax/libs/dagre/0.8.5/dagre.min.js"></script>\n')


def page(extra=""):
    return (head + "\n" + libs + f'<script id="sample-data" type="application/json">{sample}</script>\n'
            + "<script>\n" + code + "\n</script>\n" + (f"<script>\n{extra}\n</script>\n" if extra else ""))


FAVICON = ("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22%3E"
           "%3Cdefs%3E%3ClinearGradient id=%22g%22 x1=%220%22 y1=%220%22 x2=%221%22 y2=%221%22%3E%3Cstop offset=%220%22 stop-color=%22%23a77bff%22/%3E%3Cstop offset=%221%22 stop-color=%22%23ff6fc4%22/%3E%3C/linearGradient%3E%3C/defs%3E"
           "%3Crect width=%2216%22 height=%2216%22 rx=%224%22 fill=%22url(%23g)%22/%3E%3Cg fill=%22none%22 stroke=%22white%22 stroke-width=%221.3%22%3E"
           "%3Crect x=%222.5%22 y=%223%22 width=%224%22 height=%223%22 rx=%221%22/%3E%3Crect x=%229.5%22 y=%223%22 width=%224%22 height=%223%22 rx=%221%22/%3E"
           "%3Crect x=%226%22 y=%2210%22 width=%224%22 height=%223%22 rx=%221%22/%3E%3Cpath d=%22M4.5 6v2h7V6M8 8v2%22/%3E%3C/g%3E%3C/svg%3E")

site = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<meta name="description" content="Architecture, dependencies and project health of a code repository at a glance.">'
        f'<link rel="icon" href="{FAVICON}">'
        '<style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + page() + "</body></html>")
(root / "public").mkdir(exist_ok=True)
(root / "public/index.html").write_text(site, encoding="utf-8")

ext_dir = src / "ext"
exts = sorted(ext_dir.glob("*.js")) if ext_dir.exists() else []
if ext_dir.exists():
    pre = "".join(p.read_text(encoding="utf-8") for p in sorted(ext_dir.glob("*.html")))
    (root / "artifact.html").write_text(pre + page("\n".join(p.read_text(encoding="utf-8") for p in exts)), encoding="utf-8")
print("ok", len(site), "erweiterungen:", len(exts))
