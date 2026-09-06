#!/usr/bin/env python
"""
Render a Markdown document to PDF.

    python ppt/md2pdf.py review1-ppt/presentation-script.md review1-ppt/Out.pdf

No new dependency: `markdown` is already installed for this repo's tooling, and
Chrome is already a hard requirement (scripts/ui-journey.mjs drives it over the
DevTools protocol). Chrome's own print engine handles fonts, page breaks and the
Devanagari that appears in the seed data, which is more than a lightweight PDF
library would manage.

Exists because a PDF rendered from an out-of-date Markdown file is worse than no
PDF: the corrected script and the stale export disagreed, and only the export
was in front of the audience.
"""
import pathlib
import subprocess
import sys
import tempfile

import markdown

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]

CSS = """
@page { size: A4; margin: 18mm 16mm; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  font: 10.5pt/1.55 "Segoe UI", -apple-system, system-ui, sans-serif;
  color: #14151a; max-width: 100%;
}
h1 { font-size: 21pt; margin: 0 0 4pt; letter-spacing: -0.01em; }
h2 { font-size: 14pt; margin: 20pt 0 6pt; padding-top: 8pt;
     border-top: 1.5pt solid #a87a22; color: #14151a; page-break-after: avoid; }
h3 { font-size: 11.5pt; margin: 14pt 0 4pt; color: #a87a22; page-break-after: avoid; }
p, li { margin: 0 0 6pt; }
ul, ol { padding-left: 18pt; margin: 0 0 8pt; }
strong { font-weight: 650; }
em { color: #4c4e58; }
code { font: 9.5pt ui-monospace, "Cascadia Mono", Consolas, monospace;
       background: #f2f0ea; padding: 1pt 3pt; border-radius: 3px; }
pre { background: #f6f5f2; border-left: 2.5pt solid #a87a22; padding: 8pt 10pt;
      border-radius: 3px; overflow-x: auto; page-break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 8.5pt; line-height: 1.4; }
table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 9pt;
        page-break-inside: avoid; }
th, td { border: 0.5pt solid #d8d5cd; padding: 4pt 6pt; text-align: left;
         vertical-align: top; }
th { background: #f2f0ea; font-weight: 650; }
blockquote { margin: 8pt 0; padding: 6pt 12pt; border-left: 2.5pt solid #d8d5cd;
             color: #4c4e58; background: #faf9f6; }
hr { border: 0; border-top: 0.5pt solid #d8d5cd; margin: 16pt 0; }
"""


def find_chrome() -> str:
    for path in CHROME_CANDIDATES:
        if pathlib.Path(path).exists():
            return path
    sys.exit("Chrome not found. Install it, or add its path to CHROME_CANDIDATES.")


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__.strip())
    src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    if not src.exists():
        sys.exit(f"no such file: {src}")

    body = markdown.markdown(
        src.read_text(encoding="utf-8"),
        extensions=["tables", "fenced_code", "sane_lists", "toc"],
    )
    html = (
        f'<!doctype html><html><head><meta charset="utf-8">'
        f"<title>{src.stem}</title><style>{CSS}</style></head>"
        f"<body>{body}</body></html>"
    )

    # A real temp file, not stdin: Chrome's --print-to-pdf needs a URL, and a
    # file:// URL is the only way to get the CSS applied without a server.
    with tempfile.TemporaryDirectory() as tmp:
        page = pathlib.Path(tmp) / "page.html"
        page.write_text(html, encoding="utf-8")
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                find_chrome(),
                "--headless=new",
                "--disable-gpu",
                "--no-sandbox",
                "--no-pdf-header-footer",
                f"--print-to-pdf={out.resolve()}",
                page.resolve().as_uri(),
            ],
            check=True,
            capture_output=True,
            timeout=120,
        )

    size = out.stat().st_size
    print(f"wrote {out}  ({size:,} bytes) from {src}")


if __name__ == "__main__":
    main()
