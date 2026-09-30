/**
 * The security headers: what the policy allows is exactly what the pages
 * use, and nothing that only a configured gateway needs leaks into the
 * default build.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  contentSecurityPolicy, inlineScriptHashes, inlineScripts, scriptHash, servedPages, staticHeaders,
} from "../src/security-headers.js";

/** The directory server.ts serves the pages from. */
const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "../../web");

const SITE = ["https://roadassistbharat.online", "https://www.roadassistbharat.online"];
const dir = (csp: string, name: string) =>
  csp.split("; ").find((d) => d.startsWith(name + " "))?.slice(name.length + 1).split(" ") ?? [];

test("the policy closes plugins, <base> hijacking and cross-origin form posts", () => {
  const csp = contentSecurityPolicy({ frameAncestors: SITE, razorpay: false });
  assert.deepEqual(dir(csp, "object-src"), ["'none'"]);
  assert.deepEqual(dir(csp, "base-uri"), ["'self'"]);
  assert.deepEqual(dir(csp, "form-action"), ["'self'"]);
  assert.deepEqual(dir(csp, "default-src"), ["'self'"]);
});

test("only this origin and the project site may frame the pages, with or without a CORS list", () => {
  assert.deepEqual(dir(contentSecurityPolicy({ frameAncestors: SITE, razorpay: false }), "frame-ancestors"),
    ["'self'", ...SITE]);
  // A local or docker server has no CORS list; the site's live mode still frames it.
  assert.deepEqual(dir(contentSecurityPolicy({ frameAncestors: [], razorpay: false }), "frame-ancestors"),
    ["'self'", ...SITE]);
  assert.deepEqual(dir(contentSecurityPolicy({ frameAncestors: ["https://app.example.in"], razorpay: false }), "frame-ancestors"),
    ["'self'", ...SITE, "https://app.example.in"]);
});

test("Razorpay is allowed only when the real gateway is configured", () => {
  const mock = contentSecurityPolicy({ frameAncestors: [], razorpay: false });
  const real = contentSecurityPolicy({ frameAncestors: [], razorpay: true });
  assert.ok(!mock.includes("razorpay"), "the mock build must not allow a third-party script");
  assert.ok(dir(real, "script-src").includes("https://checkout.razorpay.com"));
  assert.ok(dir(real, "frame-src").includes("https://api.razorpay.com"));
});

test("scripts come from this origin only; the Draco decoder's wasm and worker are allowed", () => {
  const csp = contentSecurityPolicy({ frameAncestors: [], razorpay: false });
  assert.deepEqual(dir(csp, "script-src"), ["'self'", "'wasm-unsafe-eval'"]);
  assert.deepEqual(dir(csp, "worker-src"), ["'self'", "blob:"]);
  assert.deepEqual(dir(csp, "connect-src"), ["'self'"]);
});

test("inline scripts are allowed by hash, never by 'unsafe-inline'; styles keep it", () => {
  const h = scriptHash("console.log(1)");
  const csp = contentSecurityPolicy({ frameAncestors: [], razorpay: true, scriptHashes: [h] });
  assert.ok(!dir(csp, "script-src").includes("'unsafe-inline'"), "script-src must not allow arbitrary inline script");
  assert.ok(dir(csp, "script-src").includes(h));
  assert.ok(dir(csp, "style-src").includes("'unsafe-inline'"), "style-src keeps 'unsafe-inline' (the pages use style=)");
  // The real policy, as the server builds it from the pages it serves.
  const served = contentSecurityPolicy({ frameAncestors: [], razorpay: false, scriptHashes: inlineScriptHashes(WEB) });
  assert.ok(!dir(served, "script-src").includes("'unsafe-inline'"));
  assert.ok(dir(served, "script-src").every((s) => /^'(self|wasm-unsafe-eval|sha256-[A-Za-z0-9+/]+=*)'$/.test(s)),
    "script-src holds only 'self', the wasm allowance and hashes");
});

test("a script's hash is the one a browser computes: SHA-256 of its text, line endings normalised", () => {
  // The CSP specification's own worked example (CSP Level 3, "hash-source").
  assert.equal(scriptHash("alert('Hello, world.');"), "'sha256-qznLcsROx4GACP2dm0UCKCzCG+HiZ1guq6ZZDob/Tng='");
  // A page checked out with CRLF hashes the same as with LF, as the HTML parser sees it.
  const lf = "<script>\nvar a = 1;\nvar b = 2;\n</script>";
  assert.deepEqual(inlineScripts(lf.replace(/\n/g, "\r\n")), inlineScripts(lf));
  // External scripts have no inline body; module, importmap and plain blocks all count.
  assert.deepEqual(inlineScripts('<script src="x.js"></script><SCRIPT type="module">m()</SCRIPT><script type="importmap">{}</script>'),
    ["m()", "{}"]);
});

test("editing a page moves its hash: the policy follows the file, not a hand-kept list", () => {
  const root = mkdtempSync(join(tmpdir(), "csp-"));
  try {
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "a.html"), "<script>one()</script>");
    writeFileSync(join(root, "sub", "b.html"), "<script>two()</script><script src=x.js></script>");
    writeFileSync(join(root, "c.js"), "<script>not a page</script>");
    assert.deepEqual(inlineScriptHashes(root), [scriptHash("one()"), scriptHash("two()")].sort());
    writeFileSync(join(root, "a.html"), "<script>one(); edited()</script>");
    const after = inlineScriptHashes(root);
    assert.ok(after.includes(scriptHash("one(); edited()")) && !after.includes(scriptHash("one()")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * What a hash-based policy refuses and a page must therefore not contain: an
 * on*= handler attribute in markup, a javascript: URL, or markup built in a
 * script string that carries a handler (it would land in innerHTML).
 */
function blockedByHashes(html: string): string | null {
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const handler = /<[a-z][^>]*\son[a-z]+\s*=/i.exec(markup);
  if (handler) return `inline event handler ${handler[0].slice(0, 80)}`;
  const js = /\b(?:href|src|action|formaction)\s*=\s*["']?\s*javascript:/i.exec(html);
  if (js) return `javascript: URL ${js[0]}`;
  const built = /["'`][^"'`\n]*<[a-z][^"'`\n>]*\son[a-z]+\s*=/i.exec(html);
  if (built) return `markup with an inline handler built in script: ${built[0].slice(0, 80)}`;
  return null;
}

test("the handler scan catches what the policy would silently refuse", () => {
  assert.match(blockedByHashes('<button id="b" onclick="go()">Go</button>') ?? "", /inline event handler/);
  assert.match(blockedByHashes("<img src=x.png onerror=alert(1)>") ?? "", /inline event handler/);
  assert.match(blockedByHashes('<a href="javascript:void(0)">x</a>') ?? "", /javascript: URL/);
  assert.match(blockedByHashes("<script>el.innerHTML = '<a onclick=\"x()\">';</script>") ?? "", /built in script/);
  // Allowed: a handler assigned in script, and the word "on" in ordinary text.
  assert.equal(blockedByHashes('<script>b.onclick = go; b.addEventListener("load", f);</script><p>tap on it</p>'), null);
});

/**
 * The guard for every page the platform serves.
 *
 * Each inline script is found here by a separate scan (not inlineScripts) and
 * must be in the policy the server would send; a page that edits a script
 * keeps working because the server hashes it again, and this proves the two
 * readings of the page agree. Hashes cannot allow handler attributes or
 * javascript: URLs, so a page that grows one would break silently in the
 * browser - it fails here instead.
 */
test("every inline script in every served page is covered by a hash, and no page uses inline handlers", () => {
  const pages = servedPages(WEB);
  assert.ok(pages.some((p) => p.endsWith("app.html")) && pages.length >= 8, `found ${pages.length} pages`);
  const policy = dir(contentSecurityPolicy({ frameAncestors: [], razorpay: false, scriptHashes: inlineScriptHashes(WEB) }), "script-src");
  let checked = 0;
  for (const page of pages) {
    const html = readFileSync(page, "utf8").replace(/\r\n?/g, "\n");
    const name = relative(WEB, page);
    let at = 0;
    for (;;) {
      const open = html.toLowerCase().indexOf("<script", at);
      if (open < 0) break;
      const tagEnd = html.indexOf(">", open);
      const close = html.toLowerCase().indexOf("</script", tagEnd);
      const tag = html.slice(open, tagEnd + 1);
      at = close + 1;
      if (/\ssrc\s*=/i.test(tag)) continue;
      const body = html.slice(tagEnd + 1, close);
      const hash = `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`;
      assert.ok(policy.includes(hash), `${name}: the inline script at offset ${open} is not in script-src`);
      checked++;
    }
    const found = blockedByHashes(html);
    assert.equal(found, null, `${name}: ${found} - hashes cannot allow it; use addEventListener`);
  }
  assert.ok(checked >= 15, `only ${checked} inline scripts found - is the scan still reading the pages?`);
});

test("HSTS is sent over HTTPS only; nosniff and a referrer policy always", () => {
  assert.equal(staticHeaders(true)["strict-transport-security"], "max-age=31536000; includeSubDomains");
  assert.equal(staticHeaders(false)["strict-transport-security"], undefined);
  for (const h of [staticHeaders(true), staticHeaders(false)]) {
    assert.equal(h["x-content-type-options"], "nosniff");
    assert.equal(h["referrer-policy"], "strict-origin-when-cross-origin");
    assert.match(h["permissions-policy"], /geolocation=\(self\)/);
  }
});
