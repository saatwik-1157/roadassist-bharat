#!/usr/bin/env python3
"""Keep index.html's Content-Security-Policy in step with its inline code.

GitHub Pages cannot send headers, so the showcase's CSP is a
<meta http-equiv="Content-Security-Policy"> in index.html. It allows each
inline <script> (script-src) and the <style> block (style-src-elem) by the
SHA-256 of its exact text. Change one by a single space and the browser
refuses to run it, with nothing but a console line to say so - the page just
stops working. This catches that before it is published.

    python pages/csp-hashes.py            check; exit 1 when the hashes differ
    python pages/csp-hashes.py --write    rewrite the meta's hashes to match

pages.yml runs the check against the assembled site on every deploy. Run
--write after editing an inline script or the <style> block, and commit it.

Standard library only: the Pages runner has no Pillow or anything else.
"""
import base64
import hashlib
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

# Types a browser executes. Anything else (application/ld+json, the structured
# data in <head>) is a data block: never run, so CSP does not govern it.
JS_TYPES = {"", "module", "text/javascript", "application/javascript",
            "text/ecmascript", "application/ecmascript"}

# Where each kind of inline element's hashes live in the policy.
DIRECTIVE = {"script": "script-src", "style": "style-src-elem"}


class Inline(HTMLParser):
    """Inline <script>/<style> bodies, as the browser's parser delimits them."""

    def __init__(self):
        super().__init__(convert_charrefs=False)  # script/style text is raw: no entity decoding
        self.bodies = {"script": [], "style": []}
        self.csp = None                # (line, content) of the CSP meta
        self.first = None              # (line, tag) of the first script/style/link
        self._open = None              # (tag, [chunks]) while inside one

    def handle_starttag(self, tag, attrs):
        a = {k: (v or "") for k, v in attrs}
        line = self.getpos()[0]
        if tag == "meta" and a.get("http-equiv", "").lower() == "content-security-policy":
            if self.csp is not None:
                sys.exit(f"line {line}: a second CSP meta; keep one policy")
            self.csp = (line, a.get("content", ""))
        if tag in ("script", "style", "link") and self.first is None:
            self.first = (line, tag)
        if tag == "script" and ("src" in a or a.get("type", "").strip().lower() not in JS_TYPES):
            return                     # external (covered by 'self'), or a data block
        if tag in DIRECTIVE:
            self._open = (tag, [])

    def handle_data(self, data):
        if self._open:
            self._open[1].append(data)

    def handle_endtag(self, tag):
        if self._open and tag == self._open[0]:
            self.bodies[tag].append("".join(self._open[1]))
            self._open = None


def sha256(text):
    return "'sha256-" + base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode() + "'"


def directive_re(name):
    # The name, not a longer one it prefixes (style-src vs style-src-elem),
    # then its sources up to the ';' or the end of the attribute.
    return re.compile(r"(?<![\w-])" + re.escape(name) + r"(?![\w-])([^;\"]*)")


def main():
    write = "--write" in sys.argv[1:]
    args = [a for a in sys.argv[1:] if a != "--write"]
    page = Path(args[0] if args else Path(__file__).with_name("index.html"))
    raw = page.read_text(encoding="utf-8")
    # The browser turns CRLF and lone CR into LF before it parses anything, so a
    # Windows checkout (autocrlf) hashes the same as the Linux runner's.
    text = raw.replace("\r\n", "\n").replace("\r", "\n")

    p = Inline()
    p.feed(text)
    p.close()
    if p.csp is None:
        sys.exit(f"{page}: no <meta http-equiv=\"Content-Security-Policy\">")
    line, policy = p.csp
    # A meta policy only governs what comes after it.
    if p.first and p.first[0] <= line:
        sys.exit(f"{page}:{line}: the CSP meta must come before the first <{p.first[1]}> (line {p.first[0]})")

    want = {tag: [sha256(b) for b in bodies] for tag, bodies in p.bodies.items()}
    bad = []
    for tag, name in DIRECTIVE.items():
        m = directive_re(name).search(policy)
        if not m:
            sys.exit(f"{page}: the policy has no {name}, so the inline {tag}s have nowhere to be allowed")
        have = re.findall(r"'sha256-[^']+'", m.group(1))
        if "'unsafe-inline'" in m.group(1).split():
            bad.append(f"{name} allows 'unsafe-inline'; it must list hashes instead")
        if sorted(have) != sorted(want[tag]):
            missing = [h for h in want[tag] if h not in have]
            stale = [h for h in have if h not in want[tag]]
            bad.append(f"{name}: {len(want[tag])} inline {tag}(s) on the page, {len(have)} hash(es) in the policy"
                       + "".join(f"\n    missing {h}" for h in missing)
                       + "".join(f"\n    stale   {h}" for h in stale))

    if not bad:
        n = {tag: len(v) for tag, v in want.items()}
        print(f"  ok   CSP hashes match: {n['script']} inline script(s), {n['style']} <style> block(s)")
        return 0
    if not write:
        print("\n".join("  FAIL " + b for b in bad))
        print(f"  Inline code changed without its hash. Run: python pages/csp-hashes.py --write")
        return 1

    # Rewrite each directive as: name, its non-hash sources, then one hash per line.
    new = policy
    for tag, name in DIRECTIVE.items():
        rx = directive_re(name)
        keep = [s for s in rx.search(new).group(1).split()
                if not s.startswith("'sha256-") and s != "'unsafe-inline'"]
        body = " ".join([name] + keep) + "".join("\n    " + h for h in want[tag])
        new = rx.sub(lambda _m: body, new, count=1)
    nl = "\r\n" if "\r\n" in raw else "\n"     # keep the file's own line endings
    old, new = policy.replace("\n", nl), new.replace("\n", nl)
    if raw.count(old) != 1:
        sys.exit(f"{page}: could not find the policy text to rewrite; edit the meta by hand")
    page.write_text(raw.replace(old, new), encoding="utf-8", newline="")
    print(f"  wrote {page}: " + "; ".join(f"{DIRECTIVE[t]} {len(h)} hash(es)" for t, h in want.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
