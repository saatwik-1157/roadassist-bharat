#!/usr/bin/env node
/**
 * Claims fitness function — the documents must agree with the code.
 *
 * ── why this exists ────────────────────────────────────────────────────────
 * The same failure has now happened three times. A number that was measured and
 * true gets written into twenty-odd documents and a slide deck; later the code
 * moves; the documents do not. "57 tables" survived into 27 files and a deck
 * after the schema defined 56. "578 assertions" outlived two rounds of new
 * tests. Each time it was found by a person reading carefully, which is not a
 * mechanism.
 *
 * `check-boundaries.mjs` made the architecture rules mechanical because a rule
 * nobody can enforce is a suggestion. This does the same for the numbers, which
 * on this project are load-bearing: the whole credibility argument is that every
 * claim can be demonstrated.
 *
 * ── how it works ───────────────────────────────────────────────────────────
 * `docs/measured.json` is the single source of truth, and it records HOW each
 * number was obtained, not just what it is. This script scans every Markdown
 * file and the deck sources for the phrases those numbers appear in, and fails
 * on any that disagrees.
 *
 * ── dated evidence is exempt, on purpose ───────────────────────────────────
 * `docs/release/` and `docs/verification/` record what was true for a given
 * build. A figure there that no longer matches is not stale, it is history, and
 * rewriting it would falsify the record. They are skipped, and that distinction
 * is the one thing to preserve if this script is ever extended.
 *
 *   node scripts/check-claims.mjs          # verify
 *   node scripts/check-claims.mjs --list   # show what is being checked
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const APP = join(ROOT, "app");

const measured = JSON.parse(readFileSync(join(APP, "docs", "measured.json"), "utf8"));

/**
 * Each check is a regex with one capturing group, and the value that group must
 * hold. `allow` lists other values that are legitimately different — the payment
 * suite's 22, which is real and deliberately not executed, is the main one.
 */
const CHECKS = [
  {
    label: "total assertions",
    expect: String(measured.assertions.total),
    re: /(\d+)\s+assertions(?:\s+(?:executed|,\s*all\s+executed))/g,
    allow: [],
  },
  {
    label: "unit suite",
    expect: String(measured.assertions.suites.unit),
    // "18 unit tests" is Android's suite and legitimately different, so the
    // pattern only matches the shapes the APP's count appears in.
    re: /(\d+)\s+unit(?:,\s+\d+\s+e2e|\s+\+\s+\d+\s+end-to-end|\s+—\s+no I\/O)/g,
    allow: [],
  },
  {
    label: "application tables",
    expect: String(measured.schema.tables),
    re: /(\d+)[- ]tables?\b|\b(\d+)\s+tables\b/g,
    allow: [],
    group: (m) => m[1] ?? m[2],
  },
  {
    label: "foreign keys",
    expect: String(measured.schema.foreignKeys),
    re: /(\d+)\s+(?:foreign keys|FKs)\b/g,
    allow: [],
  },
  {
    label: "indexes",
    expect: String(measured.schema.indexes),
    re: /(\d+)\s+indexes\b/g,
    allow: [String(measured.schema.gistIndexes), String(measured.schema.uniqueIndexes)],
  },
  {
    label: "check constraints",
    expect: String(measured.schema.checkConstraints),
    re: /(\d+)\s+check constraints\b/g,
    allow: [],
  },
  {
    label: "routes",
    expect: String(measured.api.routes),
    re: /(\d+)\s+(?:routes|endpoints)\b/g,
    allow: [],
  },
  {
    label: "languages",
    expect: String(measured.i18n.locales),
    re: /(\d+)\s+languages\b/g,
    allow: [],
  },
];

/**
 * Three kinds of file legitimately hold a number that is not today's.
 *
 * 1. DATED EVIDENCE — docs/release, docs/verification. What was true for a
 *    past build. Correcting it would falsify the record.
 * 2. THE PLAN — docs/00..05-*.md describe all 18 phases in the present tense,
 *    including the 60 tables and 140 endpoints that were never built. They are
 *    targets, and the README is the authority on what exists.
 * 3. THE REVIEW-1 DECK — ppt/part_[a-g].py and review1-ppt. Superseded; only
 *    part_final.py builds the current deck.
 */
const EXEMPT_DIRS = ["docs/release", "docs/verification", "review1-ppt", "review-plan"];
const EXEMPT_FILES = [
  "app/docs/CLAIMS-AUDIT.md",      // documents the corrections, so it quotes both
  "app/scripts/check-claims.mjs",
  "app/docs/measured.json",
];
const EXEMPT_PATTERNS = [
  /^docs\/0\d-.*\.md$/,            // the 18-phase plan
  /^ppt\/part_[a-g]\d?\.py$/,      // Review-1 deck sources
  /^ppt\/(make|build_deck|md2pdf|render_visuals)\.py$/,
];

/**
 * A line may opt out with `claims-check:ignore`.
 *
 * Needed because prose sometimes has to quote a WRONG number on purpose —
 * CLAUDE.md explains that '57 tables' and '433 check constraints' were the
 * published mistakes, and a checker that cannot be told so would force the
 * explanation to be deleted. An escape hatch that must be written down beats a
 * check nobody can satisfy.
 */
const IGNORE_MARK = "claims-check:ignore";

function files(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".git", "dist", "build", ".idea", "assets"].includes(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(md|py)$/.test(entry)) out.push(p);
  }
  return out;
}

const problems = [];
let scanned = 0;

for (const file of files(ROOT)) {
  const rel = relative(ROOT, file).replaceAll("\\", "/");
  if (EXEMPT_DIRS.some((d) => rel.startsWith(d))) continue;
  if (EXEMPT_FILES.includes(rel)) continue;
  if (EXEMPT_PATTERNS.some((p) => p.test(rel))) continue;
  if (rel.endsWith(".py") && !rel.startsWith("ppt/")) continue;

  const text = readFileSync(file, "utf8");
  scanned++;

  for (const check of CHECKS) {
    check.re.lastIndex = 0;
    let m;
    while ((m = check.re.exec(text)) !== null) {
      const found = check.group ? check.group(m) : m[1];
      if (found === undefined) continue;
      if (found === check.expect || check.allow.includes(found)) continue;
      const upto = text.slice(0, m.index);
      const line = upto.split("\n").length;
      // Whole line, so the marker can sit at either end of it.
      const lineText = text.split(/\r?\n/)[line - 1] ?? "";
      if (lineText.includes(IGNORE_MARK)) continue;
      problems.push(
        `${rel}:${line}  ${check.label}: found ${found}, expected ${check.expect}` +
        `\n      ${m[0].trim()}`,
      );
    }
  }
}

if (process.argv.includes("--list")) {
  console.log("Checked against app/docs/measured.json:\n");
  for (const c of CHECKS) console.log(`  ${c.label.padEnd(22)} ${c.expect}`);
  console.log(`\nExempt (dated evidence): ${EXEMPT_DIRS.join(", ")}`);
  process.exit(0);
}

if (problems.length) {
  console.error(`✗ ${problems.length} claim(s) disagree with app/docs/measured.json:\n`);
  problems.forEach((p) => console.error("  " + p + "\n"));
  console.error(
    "Either the documents are stale, or measured.json is — re-measure with the\n" +
    "commands recorded in that file, then update whichever is wrong.\n",
  );
  process.exit(1);
}

console.log(`✓ claims consistent across ${scanned} files`);
