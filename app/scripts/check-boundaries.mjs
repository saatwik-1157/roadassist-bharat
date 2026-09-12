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

if (violations.length) {
  console.error("✗ architecture boundary violations:\n");
  violations.forEach((v) => console.error("  " + v));
  process.exit(1);
}
console.log("✓ module boundaries and offline shell clean");
