#!/usr/bin/env node
/**
 * Every zod array and set that validates input carries a length cap.
 *
 * zod collects one issue per failing element of a collection and, through
 * 4.6.5, never stopped early (GHSA-mrhx-c7xc-m3w5). Measured on this API's
 * stack: a 1 MiB body of 524,000 failing elements cost 172 MB of heap on zod
 * 3 and 301 MB on 4.6.7, per request - a handful at once exhausts a 512 MB
 * instance. 4.6.6 added the fix, but only for a collection with a length
 * constraint: with `.max(n)` the same body is refused with one issue, ~0 MB
 * and 10 ms. The upgrade is therefore half the fix and the cap is the other
 * half, and the cap is the half a new route can forget. So it is enforced.
 *
 * Passes: `z.array(x).max(n)`, `.length(n)`, `z.array(x).min(1).max(n)`,
 * `x.array().max(n)`, and the same for `z.set`. A `.max()` inside the element
 * schema - `z.array(z.string().max(12))` - bounds the element, not the
 * array, and does not count.
 *
 * An internal schema that never sees a request body can opt out on its own
 * line, with a reason: `// bounded-collections:ignore <why>`. A bare marker
 * with no reason is itself a failure.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const APP = join(ROOT, "app");
/** Where request schemas live. Tests and generated output are not scanned. */
export const SCAN_DIRS = [join(APP, "apps", "api", "src"), join(APP, "packages", "db", "src")];

/** `z.array(` / `z.set(` and the method form `.array(` - the index points at "(". */
const OPENERS = [/\bz\s*\.\s*(array|set)\s*\(/g, /\.\s*(array)\s*\(/g];
const BOUNDS = new Set(["max", "length"]);
const IGNORE = /bounded-collections:ignore\b[ \t]*(.*)$/;

/**
 * Index just past the parenthesis that closes the one at `open`, or -1.
 * Skips strings, template literals and comments so a ")" inside a message
 * does not end the call early.
 */
export function closeParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) return -1; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2); if (i < 0) return -1; i++; continue; }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i + 1;
  }
  return -1;
}

/** The method names chained after `from`: `.min(1).max(200)` → ["min", "max"]. */
export function chainAfter(src, from) {
  const names = [];
  let i = from;
  for (;;) {
    const m = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*\.\s*([A-Za-z_$][\w$]*)\s*/.exec(src.slice(i));
    if (!m) return names;
    names.push(m[1]);
    i += m[0].length;
    if (src[i] !== "(") return names;   // a property, not a call: the chain ends
    i = closeParen(src, i);
    if (i < 0) return names;
  }
}

const lineOf = (src, index) => src.slice(0, index).split("\n").length;

/** Every collection schema in one source file, judged. */
export function checkSource(src) {
  const lines = src.split("\n");
  const found = [];
  for (const opener of OPENERS) {
    for (const m of src.matchAll(opener)) {
      const open = m.index + m[0].length - 1;
      // `z.array(` also matches the method pattern at ".array("; count it once.
      if (opener === OPENERS[1] && /\bz\s*$/.test(src.slice(Math.max(0, m.index - 8), m.index))) continue;
      const line = lineOf(src, m.index);
      const kind = opener === OPENERS[0] ? `z.${m[1]}` : ".array()";
      const close = closeParen(src, open);
      if (close < 0) {
        found.push({ line, kind, ok: false, why: "could not find the end of the call" });
        continue;
      }
      const chain = chainAfter(src, close);
      if (chain.some((n) => BOUNDS.has(n))) {
        found.push({ line, kind, ok: true, chain });
        continue;
      }
      const ignore = IGNORE.exec(lines[line - 1]);
      if (ignore && ignore[1].trim()) {
        found.push({ line, kind, ok: true, chain, ignored: ignore[1].trim() });
      } else {
        found.push({
          line, kind, ok: false, chain,
          why: ignore ? "bounded-collections:ignore needs a reason" : "no .max() or .length() on the collection",
        });
      }
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

function* tsFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* tsFiles(p);
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) yield p;
  }
}

export function scan(dirs = SCAN_DIRS) {
  const problems = [];
  let collections = 0;
  for (const dir of dirs) {
    for (const file of tsFiles(dir)) {
      for (const c of checkSource(readFileSync(file, "utf8"))) {
        collections++;
        if (!c.ok) problems.push({ rel: relative(ROOT, file).split(sep).join("/"), ...c });
      }
    }
  }
  return { problems, collections };
}

function main() {
  const { problems, collections } = scan();
  if (problems.length) {
    console.error(`✗ ${problems.length} zod collection(s) without a length cap:\n`);
    for (const p of problems) console.error(`  ${p.rel}:${p.line}  ${p.kind}: ${p.why}`);
    console.error(
      "\nAdd .max(n) to the collection itself. Without it zod 4 validates every\n" +
      "element of a hostile 1 MiB body and keeps an issue for each one\n" +
      "(GHSA-mrhx-c7xc-m3w5); with it the body is refused at the cap.\n",
    );
    process.exit(1);
  }
  console.log(`✓ ${collections} zod collection(s), each with a length cap`);
}

// Run only when invoked directly; the regression tests import the functions.
const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
if (invoked.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) main();
