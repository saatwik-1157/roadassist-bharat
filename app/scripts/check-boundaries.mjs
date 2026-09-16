#!/usr/bin/env node
/**
 * Architecture fitness function (ADR-0002).
 *
 * We ship a modular monolith, which only stays modular if the boundaries are
 * enforced mechanically. Rules:
 *   1. A schema module may import only from _shared and modules it declares below.
 *   2. Nothing outside packages/db may import a schema file directly — the
 *      package index is the contract.
 *   3. Every local script, stylesheet, font sheet, manifest and icon a cached
 *      page loads must itself be in SHELL_ASSETS, or Off-Grid Mode ships
 *      without it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** Which schema modules each module is allowed to depend on. */
const ALLOWED = {
  _shared: [],
  identity: ["_shared"],
  fleet: ["_shared", "identity"],
  service: ["_shared", "identity", "fleet"],
  ops: ["_shared", "identity", "fleet", "service"],
  raksha: ["_shared", "identity", "service"],   // ADR-0007
};

const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|mjs|js)$/.test(entry)) check(p);
  }
}

function check(file) {
  const rel = relative(ROOT, file).replaceAll("\\", "/");
  const src = readFileSync(file, "utf8");
  const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);

  const schemaMatch = rel.match(/packages\/db\/src\/schema\/([a-z_]+)\.ts$/);
  if (schemaMatch) {
    const self = schemaMatch[1];
    for (const imp of imports) {
      const dep = imp.match(/\.\/([a-z_]+)\.js$/)?.[1];
      if (!dep) continue;
      if (!ALLOWED[self]?.includes(dep)) {
        violations.push(`${rel}: schema module "${self}" may not import "${dep}" (allowed: ${ALLOWED[self]?.join(", ") || "none"})`);
      }
    }
    return;
  }

  if (rel.startsWith("packages/db/")) return;
  for (const imp of imports) {
    if (imp.includes("@roadassist/db/src") || imp.includes("db/src/schema")) {
      violations.push(`${rel}: reaches into @roadassist/db internals — import from the package root instead`);
    }
  }
}

walk(join(ROOT, "packages"));
try { walk(join(ROOT, "apps")); } catch { /* no apps yet at Phase 2 */ }

// ── the offline shell must be complete ──────────────────────────────────────
//
// Rule 3: every local script a cached page loads must itself be cached.
//
// Off-Grid Mode is the product's central claim, and it fails in the quietest
// possible way — the page still boots, one script is simply missing, and the
// feature it powered is gone. That is exactly what happened when the language
// switch landed: app.html loaded /i18n.js, SHELL_ASSETS did not list it, and
// every off-grid user silently fell back to English. Nothing failed, nothing
// logged, and the one place a reader most needs their own language is the
// hard shoulder with no signal.
//
// A person cannot be relied on to remember this. The check can.
function checkOfflineShell() {
  const web = join(ROOT, "apps", "web");
  let sw;
  try { sw = readFileSync(join(web, "sw.js"), "utf8"); } catch { return; }

  const listed = new Set(
    [...sw.matchAll(/"(\/[^"]+)"/g)].map((m) => m[1]),
  );
  const cachedPages = [...listed].filter((p) => p.endsWith(".html"));

  for (const page of cachedPages) {
    let html;
    try { html = readFileSync(join(web, page.slice(1)), "utf8"); } catch { continue; }
    // Scripts AND the boot-critical <link>s. The rule was written for the
    // missing script that prompted it and checked only <script src>, which
    // leaves the identical failure open one tag along: a cached page whose
    // stylesheet is uncached still boots off-grid, simply with no styling, and
    // nothing logs. Fonts, the manifest and the icons fail the same quiet way.
    const refs = [
      ...[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => ["loads", m[1]]),
      ...[...html.matchAll(/<link\b[^>]*>/g)]
        .filter((t) => /rel="(?:stylesheet|manifest|icon|apple-touch-icon)"/.test(t[0]))
        .map((t) => ["links", t[0].match(/href="([^"]+)"/)?.[1]]),
    ];

    for (const [verb, src] of refs) {
      if (!src) continue;
      if (/^https?:|^\/\/|^data:/.test(src)) continue;   // external, not ours to cache
      const abs = (src.startsWith("/") ? src : "/" + src).split("?")[0];
      if (!listed.has(abs)) {
        violations.push(
          `apps/web/sw.js: ${page} ${verb} ${src}, which is not in SHELL_ASSETS — ` +
          "off-grid users would load the page without it",
        );
      }
    }
  }
}
checkOfflineShell();

// ── the app shell must stay bootable in the order it assumes ───────────
//
// Rule 4: a cached page's inline script is a CLASSIC script, wrapped, and does
// not grow by accident.
//
// app.html carries the whole citizen app in one inline IIFE, and says so in a
// comment: 'this file is one classic script and stays that way'. That is not
// style, it is load order. A <script type="module"> is DEFERRED, so it runs
// after every classic script on the page — which is why Off-Grid Mode is reached
// through a dynamic import() rather than a module tag. Convert that block to a
// module, or add a module tag beside it that the block depends on, and the app
// still loads: it simply boots in a different order, and the failure surfaces
// as Off-Grid Mode being absent rather than as an error.
//
// A comment cannot stop that. This can. Three things are checked, and each one
// is a rule the code already follows — nothing here asks for a change today.
function checkAppShell() {
  const web = join(ROOT, "apps", "web");
  let sw;
  try { sw = readFileSync(join(web, "sw.js"), "utf8"); } catch { return; }
  // Deduped: sw.js names app.html both in SHELL_ASSETS and in its navigation
  // fallback, and one mistake should be reported once.
  const cached = [...new Set([...sw.matchAll(/"(\/[^"]+\.html)"/g)].map((m) => m[1]))];

  // Measured, not guessed: the size each cached page is today, plus a little
  // headroom so ordinary maintenance does not trip it. Raising one is fine and
  // expected — do it in the same commit that grows the page, so the growth is a
  // decision somebody made rather than a drift nobody noticed.
  const CEILING = { "/app.html": 4700, "/mechanic.html": 1200, "/map.html": 500 };

  for (const page of cached) {
    let html;
    try { html = readFileSync(join(web, page.slice(1)), "utf8"); } catch { continue; }

    // (a) no deferred script on a page whose inline code runs first.
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
      if (/type="module"/.test(tag)) {
        violations.push(
          `apps/web${page}: ${tag} — a module script is deferred and runs AFTER the ` +
          "inline shell it would have to load before. Reach modules through a " +
          "dynamic import(), the way Off-Grid Mode does.",
        );
      }
    }

    // (b) the shell stays wrapped. An IIFE under 'use strict' is what keeps a
    // 4,500-line page from publishing 115 names onto window, and it is the
    // thing a careless extraction would quietly undo.
    const lines = html.split(/\r?\n/);
    const wrapped = lines.some((l, i) =>
      l.trim() === "<script>" &&
      (lines[i + 1] ?? "").trim().startsWith("(function ()") &&
      (lines[i + 2] ?? "").includes("use strict"));
    if (!wrapped && (CEILING[page] ?? 0) > 800) {
      violations.push(
        `apps/web${page}: its inline script is no longer an IIFE under 'use strict' — ` +
        "every name in it is now global.",
      );
    }

    // (c) growth is a decision.
    const cap = CEILING[page];
    if (cap && lines.length > cap) {
      violations.push(
        `apps/web${page}: ${lines.length} lines, over the ${cap} this rule records. ` +
        "Split it, or raise the ceiling in check-boundaries.mjs and say why.",
      );
    }
  }
}
checkAppShell();

if (violations.length) {
  console.error("✗ architecture boundary violations:\n");
  violations.forEach((v) => console.error("  " + v));
  process.exit(1);
}
console.log("✓ module boundaries and offline shell clean");
