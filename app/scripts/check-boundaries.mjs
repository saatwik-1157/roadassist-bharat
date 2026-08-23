#!/usr/bin/env node
/**
 * Architecture fitness function (ADR-0002).
 *
 * We ship a modular monolith, which only stays modular if the boundaries are
 * enforced mechanically. Rules:
 *   1. A schema module may import only from _shared and modules it declares below.
 *   2. Nothing outside packages/db may import a schema file directly — the
 *      package index is the contract.
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

if (violations.length) {
  console.error("✗ architecture boundary violations:\n");
  violations.forEach((v) => console.error("  " + v));
  process.exit(1);
}
console.log("✓ module boundaries clean");
