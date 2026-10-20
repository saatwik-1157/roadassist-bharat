/**
 * The Privacy policy and Terms of use: served, complete, and self-contained.
 *
 * Google asks for both links before the OAuth app can be published, and the
 * policy promises that our pages load nothing from another website. These
 * tests hold the pages to that: they are served the way server.ts serves every
 * page (the same static root, the same security headers), they carry the
 * sections the policy is meant to have, every inline script is allowed by the
 * CSP, and no tag makes the browser fetch a third-party host. The browser
 * suite (ui-journey §1b) loads them in Chrome; e2e-journey §43 fetches them
 * from the running server.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { inlineScripts, registerSecurityHeaders, scriptHash } from "../src/security-headers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, "../../web");
const REPO = resolve(HERE, "../../../..");
const read = (p: string) => readFileSync(p, "utf8");

const PAGES = {
  "/privacy.html": [
    "Effective 15 October 2026", "not an emergency service", "112",
    'id="collect"', 'id="where"', 'id="share"', 'id="keep"', 'id="rights"', 'id="children"', 'id="contact"',
    "Singapore", "Neon", "Render", "Telegram", "Google", "never sell",
    "no automatic deletion", "Digital Personal Data Protection Act, 2023", "under 18",
    "https://github.com/saatwik-1157/roadassist-bharat/issues",
  ],
  "/terms.html": [
    "Effective 15 October 2026", "Not an emergency service", "112", "as is",
    'id="use"', 'id="mechanics"', 'id="ai"', 'id="liability"', 'id="law"', 'id="contact"',
    "demo data", "can be wrong", "laws of India",
    "https://github.com/saatwik-1157/roadassist-bharat/issues",
  ],
} as const;

async function served() {
  const app = Fastify();
  await app.register(fastifyStatic, { root: WEB, prefix: "/", dotfiles: "deny" });
  registerSecurityHeaders(app, { frameAncestors: [], razorpay: false, pagesRoot: WEB });
  await app.ready();
  return app;
}

/** Every URL the browser would fetch on its own while rendering: src, <link href>, CSS url(). */
function subresources(html: string): string[] {
  return [
    ...[...html.matchAll(/\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]),
    ...[...html.matchAll(/<link\b[^>]*>/gi)]
      .filter((m) => !/rel\s*=\s*["']?(canonical|alternate)/i.test(m[0]))
      .map((m) => /href\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1] ?? ""),
    ...[...html.matchAll(/url\(\s*["']?([^"')]+)/gi)].map((m) => m[1]),
    ...[...html.matchAll(/@import\s+["']([^"']+)/gi)].map((m) => m[1]),
  ].filter(Boolean);
}

test("both pages are served with 200, as HTML, under the platform's CSP", async () => {
  const app = await served();
  try {
    for (const url of Object.keys(PAGES)) {
      const res = await app.inject({ method: "GET", url });
      assert.equal(res.statusCode, 200, url);
      assert.match(String(res.headers["content-type"]), /^text\/html/, url);
      const csp = String(res.headers["content-security-policy"] ?? "");
      assert.match(csp, /default-src 'self'/, url);
      // The theme boot is the pages' only inline script, and the policy allows it by hash.
      const scripts = inlineScripts(res.body);
      assert.ok(scripts.length >= 1, url);
      for (const s of scripts) assert.ok(csp.includes(scriptHash(s)), `${url}: inline script not in the CSP`);
    }
  } finally {
    await app.close();
  }
});

test("each page carries the sections it promises", () => {
  for (const [url, needles] of Object.entries(PAGES)) {
    const html = read(resolve(WEB, url.slice(1)));
    for (const n of needles) assert.ok(html.includes(n), `${url} lacks ${JSON.stringify(n)}`);
  }
});

test("the pages load nothing from another host, have no handler attributes, and name no personal email", () => {
  for (const url of Object.keys(PAGES)) {
    const html = read(resolve(WEB, url.slice(1)));
    const external = subresources(html).filter((u) => /^(https?:)?\/\//i.test(u));
    assert.deepEqual(external, [], `${url} fetches a third-party resource`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${url} has an inline handler`);
    assert.doesNotMatch(html, /javascript:/i, url);
    // Contact is GitHub issues only, never an address of a team member.
    assert.doesNotMatch(html, /mailto:|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, `${url} publishes an email address`);
    // Sign-in hosts are reached only through the server's redirect (check-data-residency.mjs).
    assert.doesNotMatch(html, /accounts\.google\.com|apis\.google\.com|gstatic\.com/i, url);
  }
});

test("the shell caches both pages, so they open offline like the app that links them", () => {
  const sw = read(resolve(WEB, "sw.js"));
  assert.match(sw, /"\/privacy\.html"/);
  assert.match(sw, /"\/terms\.html"/);
});

test("sign-in, Settings, the landing page and the project site link to both", () => {
  const app = read(resolve(WEB, "app.html"));
  // Sign-in and Settings → Session: two of each, translated by i18n.js.
  assert.equal(app.match(/href="\/privacy\.html"[^>]*data-i18n="legal\.privacy"/g)?.length, 2);
  assert.equal(app.match(/href="\/terms\.html"[^>]*data-i18n="legal\.terms"/g)?.length, 2);
  const i18n = read(resolve(WEB, "i18n.js"));
  assert.equal(i18n.match(/"legal\.privacy":/g)?.length, 8, "a legal.privacy string per locale");
  assert.equal(i18n.match(/"legal\.terms":/g)?.length, 8, "a legal.terms string per locale");
  const landing = read(resolve(WEB, "landing.html"));
  assert.match(landing, /href="\/privacy\.html"/);
  assert.match(landing, /href="\/terms\.html"/);
  const site = read(resolve(REPO, "pages/index.html"));
  assert.match(site, /href="https:\/\/app\.roadassistbharat\.online\/privacy\.html"/);
  assert.match(site, /href="https:\/\/app\.roadassistbharat\.online\/terms\.html"/);
});
