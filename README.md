# Repo Screener

Ein Screener und Visualisierer für Code-Projekte. Er läuft komplett im Browser, ohne Server, und lässt sich als statische Seite hosten (z. B. auf Vercel).

## Was er macht

1. **Einlesen:** Standardbranch, rekursiver Dateibaum und README über die GitHub-API, oder ein lokaler Ordner, der den Browser nie verlässt.
2. **Quellcode-Stichprobe:** bis zu 220 Quelldateien (JS/TS/Python), gleichmäßig über die Ordner verteilt. Daraus werden die Importe extrahiert und aufgelöst, inklusive `@/`-Alias, `index`-Dateien und relativer Python-Importe.
3. **Bausteine:** Die Ordner werden adaptiv auf etwa 8 bis 16 Bausteine aufgeteilt. Wrapper wie `src/` oder `app/` werden aufgelöst, große Fachbereiche wie `todo/` in Components, Services, Shared und Model zerlegt. Jeder Baustein bekommt einen lesbaren Namen (z. B. „Todo Services“) und seine wichtigste Datei als Untertitel.
4. **Externe Dienste und Einstieg:** Paket-Importe werden bekannten Diensten zugeordnet, etwa Clerk, Supabase, Postgres, Redis, Stripe, OpenAI, S3, Sentry oder HTTP-APIs (mit dem Host aus den Umgebungsdateien). Ein Nutzer-Knoten zeigt auf die App-Shell.
5. **Beziehungen:** Pro Baustein bleiben nur die stärksten Abhängigkeiten. Schwache Abkürzungen über einen Zwischenbaustein fallen weg. Jede Beziehung trägt ein Verb („ruft auf“, „nutzt“, „authentifiziert“, „liest Konfig“ …), die Anzahl der Importe steht im Detail-Panel.
6. **Architektur-Canvas:** Das Layout berechnet dagre von oben nach unten: Nutzer → Oberfläche → Fachlogik → Kern → externe Dienste in einer eigenen Zeile. Ein Klick auf eine Karte öffnet ein Detail-Panel mit Dateien, Sprachen, Beziehungen und Links zu GitHub.

Außerdem:

- **Screening:** 10 Prüfungen mit Score. Geprüft werden README, Lizenz, CI, Testquote, Doku, Lockfile, Lint/Format, Deployment, eingecheckte `.env` und große Dateien.
- **Stack-Erkennung** über Konfigurationsdateien und `package.json`/`requirements.txt`.
- **Treemap:** Fläche = Dateigröße, Farbe = Sprache, Klick zoomt hinein.
- Filterbarer **Dateibaum**.
- **Export** des Diagramms als Mermaid-Quelltext.

## Bedienung

| Aktion | Eingabe |
|---|---|
| Arbeitsfläche verschieben | Ziehen (mit Schwung) oder Scrollen |
| Zoomen | ⌘/Strg + Scrollen oder die Knöpfe unten links |
| Komponente öffnen | Karte anklicken |
| Panel schließen | ✕, `Esc` oder nach rechts wegziehen |
| Suche fokussieren | `/` oder ⌘/Strg + K |

Mit `?repo=owner/repo` in der URL wird ein Repo direkt analysiert.

Ohne Token gilt das GitHub-Limit von 60 API-Aufrufen pro Stunde. Pro Analyse sind nur 2 API-Aufrufe nötig, die Quelldateien kommen über raw.githubusercontent.com. Für private Repos lässt sich über das Schlüssel-Symbol ein Token eintragen. Es bleibt nur im Arbeitsspeicher.

## Entwicklung

```bash
python3 build.py
```

Der Befehl erzeugt `public/index.html`. Die Datei kann direkt im Browser geöffnet werden.

| Datei | Zweck |
|---|---|
| `src/ui-head.html` | Styles und Markup |
| `src/core.js` | Analyse: Sprachen, Komponenten, Importe, Stack, Screening, Lader |
| `src/ui.js` | Oberfläche: Canvas, Federanimationen, Panel, Treemap, Dateien, Screening |
| `src/sample.json` | Beispieldaten (Dateibaum und Importe eines öffentlichen Repos) |
| `build.py` | setzt alles zu einer Seite zusammen |
| `vercel.json` | Build-Konfiguration für Vercel |

Bibliotheken: d3 7.9.0 und dagre 0.8.5 (beide von cdnjs).

## Deployment auf Vercel

Repo in Vercel importieren. Build-Befehl und Ausgabeordner kommen aus `vercel.json`.
