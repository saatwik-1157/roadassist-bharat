"""Export the translation review sheets from the source files.

    python docs/translations/export.py

The source files are the truth; these sheets are a view of them for reviewers
who do not read code. Run this after any string is added or changed. Review
columns (OK? and Correction / notes) already filled in a sheet are kept, row by
row, by key, so re-exporting never throws a reviewer's work away.

  review-android.csv     mobile/app/src/main/res/values*/strings.xml
                         (translatable strings, in the order values/ lists them)
  review-web-app.csv     app/apps/web/i18n.js     (MESSAGES)
  review-sms-server.csv  app/apps/api/src/i18n.ts (MESSAGES)

Standard library only. Written UTF-8 with a BOM, so Excel shows Indic scripts.
"""
import csv
import html
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "docs", "translations")

LOCALES = [("hi", "Hindi"), ("ta", "Tamil"), ("te", "Telugu"), ("bn", "Bengali"),
           ("mr", "Marathi"), ("kn", "Kannada"), ("gu", "Gujarati")]
HEADER = (["key", "English (en)"] + [f"{name} ({code})" for code, name in LOCALES]
          + [f"{name} OK? (Y/N)" for _, name in LOCALES] + ["Correction / notes"])
REVIEW_COLS = len(LOCALES) + 1


def read(path):
    with io.open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


# ── Android ─────────────────────────────────────────────────────────────────
STRING = re.compile(r'<string name="([^"]+)"([^>]*)>(.*?)</string>', re.S)


def android_strings(xml, translatable_only=False):
    out = {}
    for m in STRING.finditer(xml):
        if translatable_only and 'translatable="false"' in m.group(2):
            continue
        # Android escapes apostrophes and quotes; a reviewer should see the text.
        out[m.group(1)] = html.unescape(m.group(3)).replace("\\'", "'").replace('\\"', '"')
    return out


def android_rows():
    res = "mobile/app/src/main/res"
    en = android_strings(read(f"{res}/values/strings.xml"), translatable_only=True)
    loc = {code: android_strings(read(f"{res}/values-{code}/strings.xml")) for code, _ in LOCALES}
    return [[k, v] + [loc[code].get(k, "") for code, _ in LOCALES] for k, v in en.items()]


# ── web and SMS: a JS object literal of locale → { key: "string" } ──────────
PAIR = re.compile(r'"([^"\\]+)"\s*:\s*"((?:[^"\\]|\\.)*)"')


def js_unescape(s):
    return re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), s) \
        .replace('\\"', '"').replace("\\'", "'").replace("\\n", "\n").replace("\\\\", "\\")


def js_catalogue(src):
    """Split `MESSAGES = { en: { ... }, hi: { ... } }` into one dict per locale."""
    body = src[src.index("MESSAGES"):]
    starts = [(m.group(1), m.end()) for m in re.finditer(r'\n\s*(en|hi|ta|te|bn|mr|kn|gu)\s*:\s*\{', body)]
    cat = {}
    for i, (code, start) in enumerate(starts):
        end = starts[i + 1][1] if i + 1 < len(starts) else len(body)
        if code in cat:      # only the first block per locale is the catalogue
            continue
        cat[code] = {k: js_unescape(v) for k, v in PAIR.findall(body[start:end])}
    return cat


def js_rows(path):
    cat = js_catalogue(read(path))
    return [[k, v] + [cat.get(code, {}).get(k, "") for code, _ in LOCALES] for k, v in cat["en"].items()]


# ── write, keeping any review already done ──────────────────────────────────
def write(name, rows):
    path = os.path.join(OUT, name)
    kept = {}
    if os.path.exists(path):
        with io.open(path, encoding="utf-8-sig", newline="") as f:
            for r in list(csv.reader(f))[1:]:
                # Review columns come after the eight languages. A row exported
                # before anyone reviewed it simply stops at the translations.
                review = r[len(HEADER) - REVIEW_COLS:]
                if r and any(c.strip() for c in review):
                    kept[r[0]] = review + [""] * (REVIEW_COLS - len(review))
    with io.open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, quoting=csv.QUOTE_ALL)
        w.writerow(HEADER)
        for r in rows:
            w.writerow(r + kept[r[0]] if r[0] in kept else r)
    empty = sum(1 for r in rows for c in r[1:] if not c)
    print(f"{name}: {len(rows)} strings, {len(kept)} reviewed rows kept, {empty} empty translation cells")


if __name__ == "__main__":
    write("review-android.csv", android_rows())
    write("review-web-app.csv", js_rows("app/apps/web/i18n.js"))
    write("review-sms-server.csv", js_rows("app/apps/api/src/i18n.ts"))
