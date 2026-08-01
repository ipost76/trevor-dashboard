"""Hub API helper — converts a downloads/active/<filename>.md to a styled PDF.

⚠️ SUPERSEDED — NOT ON THE RENDER PATH.  [B4, 2026-08-01]

The Docs → PDF control no longer reaches this script. It now prints
client-side, through the shared print document
(src/components/ui/markdown-print-document.tsx) — the mechanism D3/D4 built and
verified for the nightly digest, which needs no dependencies at all.

🚨 THIS SCRIPT HAS NEVER WORKED ON THE WSL HUB. `weasyprint` (line ~29) and
`pygments` (line ~28) are imported at MODULE TOP LEVEL, and both are absent
here — measured 2026-08-01:

    venv/bin/python3 -c "import weasyprint"
    ModuleNotFoundError: No module named 'weasyprint'

Because the failure is at import, it happens BEFORE main()'s try/except can
emit the JSON error shape below, so runPython throws and the route returned a
bare 500 on every call. Installing it needs root, which `trevor` does not have
(FORTRESS-C4).

LEFT IN PLACE DELIBERATELY, not overlooked. It is off the render path either
way, removal is a behaviour change nothing measured asked for, and its PAGE_CSS
remains the only record of the intended print styling. Do not "fix" it by
installing a PDF library — the whole point of the replacement is that it needs
none.

Invoked by /api/docs/downloads/[filename]/pdf. Resolves the source under the
Hub's runPython cwd (TREVOR_DIR=/home/trevor/trevor), so relative paths point
at the bot's downloads tree.

Output (stdout, always exit 0):
  {"path": "<abs path>", "size": <bytes>, "cached": <bool>}        on success
  {"error": "not found"}                                            (route → 404)
  {"error": "<message>"}                                            (route → 500)

Cache:
  downloads/.pdf_cache/<sha256(filename + source mtime_ns)>.pdf
  Subsequent calls reuse the cached PDF instantly. Cache invalidates whenever
  the source .md is modified (mtime changes).

Sacred files untouched. Does not import download_manager. No DB access.
"""

import hashlib
import html
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import markdown as md
from pygments.formatters import HtmlFormatter
from weasyprint import CSS, HTML

ACTIVE_DIR = Path("downloads/active")
CACHE_DIR = Path("downloads/.pdf_cache")


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj))
    sys.stdout.flush()
    sys.exit(0)


def cache_target(src: Path) -> Path:
    digest = hashlib.sha256()
    digest.update(src.name.encode("utf-8"))
    digest.update(str(src.stat().st_mtime_ns).encode("ascii"))
    return CACHE_DIR / f"{digest.hexdigest()}.pdf"


PAGE_CSS = """
@page {
  size: letter;
  margin: 1in;
  @bottom-center {
    content: counter(page) " / " counter(pages);
    font-family: 'DejaVu Serif', serif;
    font-size: 9pt;
    color: #666;
  }
}
body {
  font-family: 'DejaVu Serif', 'Liberation Serif', 'Georgia', serif;
  font-size: 11pt;
  line-height: 1.45;
  color: #1a1a1a;
}
.docheader {
  display: flex;
  justify-content: space-between;
  gap: 16pt;
  font-family: 'DejaVu Sans', 'Liberation Sans', sans-serif;
  font-size: 9pt;
  color: #555;
  border-bottom: 0.5pt solid #bbb;
  padding-bottom: 5pt;
  margin-bottom: 18pt;
}
.docheader .filename { word-break: break-all; }
.docheader .docdate { white-space: nowrap; }
h1 {
  font-size: 22pt;
  font-weight: bold;
  margin: 0 0 0.5em 0;
  padding-bottom: 7pt;
  border-bottom: 1.5pt solid #222;
  page-break-after: avoid;
}
h2 {
  font-size: 16pt;
  font-weight: bold;
  margin: 1.2em 0 0.4em 0;
  padding-bottom: 3pt;
  border-bottom: 0.4pt solid #888;
  page-break-after: avoid;
}
h3 {
  font-size: 13pt;
  font-weight: bold;
  margin: 1em 0 0.3em 0;
  color: #333;
  page-break-after: avoid;
}
h4, h5, h6 {
  font-size: 11pt;
  font-weight: bold;
  margin: 0.8em 0 0.2em 0;
}
p { margin: 0 0 0.6em 0; }
ul, ol { margin: 0 0 0.6em 0; padding-left: 1.4em; }
li { margin: 0 0 0.2em 0; }
code {
  font-family: 'DejaVu Sans Mono', 'Liberation Mono', monospace;
  font-size: 9.5pt;
  background: #f1f1f1;
  padding: 0.5pt 3pt;
  border-radius: 2pt;
}
pre, div.codehilite > pre, div.codehilite {
  font-family: 'DejaVu Sans Mono', 'Liberation Mono', monospace;
  font-size: 8.5pt;
  background: #f6f6f6;
  border: 0.4pt solid #ddd;
  border-radius: 3pt;
  padding: 8pt 10pt;
  margin: 0.5em 0 0.8em 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  line-height: 1.35;
  color: #222;
}
pre code, div.codehilite code {
  background: none;
  padding: 0;
  border-radius: 0;
  font-size: inherit;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.5em 0 0.9em 0;
  font-size: 9.5pt;
}
th, td {
  border: 0.4pt solid #999;
  padding: 4pt 8pt;
  text-align: left;
  vertical-align: top;
}
th {
  background: #e8e8e8;
  font-weight: bold;
}
tr:nth-child(even) td { background: #fafafa; }
blockquote {
  border-left: 2pt solid #999;
  margin: 0.6em 0;
  padding: 0.1em 0 0.1em 12pt;
  color: #555;
  font-style: italic;
}
hr {
  border: none;
  border-top: 0.5pt solid #aaa;
  margin: 1.2em 0;
}
a { color: #1a5fb4; text-decoration: none; }
img { max-width: 100%; height: auto; }
strong { font-weight: bold; }
em { font-style: italic; }
"""


def render(src: Path, target: Path, filename: str) -> None:
    text = src.read_text(encoding="utf-8")
    html_body = md.markdown(
        text,
        extensions=[
            "tables",
            "fenced_code",
            "codehilite",
            "sane_lists",
            "attr_list",
            "def_list",
        ],
        extension_configs={
            "codehilite": {
                "css_class": "codehilite",
                "guess_lang": False,
                "linenums": False,
            },
        },
    )
    pygments_css = HtmlFormatter(style="default").get_style_defs(".codehilite")
    css_str = PAGE_CSS + "\n" + pygments_css

    gen_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    header = (
        '<div class="docheader">'
        f'<span class="filename">{html.escape(filename)}</span>'
        f'<span class="docdate">{html.escape(gen_date)}</span>'
        "</div>"
    )
    html_doc = (
        '<!doctype html><html><head><meta charset="utf-8"></head>'
        f"<body>{header}{html_body}</body></html>"
    )

    tmp = target.with_suffix(".pdf.tmp")
    HTML(string=html_doc).write_pdf(str(tmp), stylesheets=[CSS(string=css_str)])
    tmp.replace(target)


def main() -> None:
    if len(sys.argv) < 2:
        emit({"error": "missing filename"})
    filename = sys.argv[1]
    if not filename or "/" in filename or ".." in filename or filename.startswith("."):
        emit({"error": "invalid filename"})
    if not filename.lower().endswith(".md"):
        emit({"error": "not a markdown file"})
    src = ACTIVE_DIR / filename
    if not src.is_file():
        emit({"error": "not found"})

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    target = cache_target(src)
    if target.is_file() and target.stat().st_size > 0:
        emit({
            "path": str(target.resolve()),
            "size": target.stat().st_size,
            "cached": True,
        })

    try:
        render(src, target, filename)
    except Exception as exc:
        emit({"error": f"conversion failed: {exc}"})

    emit({
        "path": str(target.resolve()),
        "size": target.stat().st_size,
        "cached": False,
    })


if __name__ == "__main__":
    main()
