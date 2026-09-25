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
 * file, the deck sources and the web pages for the phrases those numbers
 * appear in, and fails on any that disagrees.
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
 * The security story is told two ways, and both are true: the security suite on
 * its own is the attack count, and "across two suites" means it plus the gateway
 * suite. Derived rather than written down, so growing either suite moves the sum
 * and a document still quoting the old one fails.
 */
const ATTACKS_BOTH_SUITES = String(
  measured.assertions.suites.securityAudit + measured.assertions.suites.gatewaySecurity,
);

/**
 * The size of each suite, keyed by the npm script that runs it. ENGINEERING-NOTES.md and
 * app/README.md write these as trailing comments on the commands — a shape no
 * prose regex matches, which is how `npm run test:gateway  # 26` survived the
 * suite growing to 27 in the same commit that added this checker.
 */
const SCRIPT_SIZES = {
  "test": String(measured.assertions.suites.unit),
  "test:e2e": String(measured.assertions.suites.e2e),
  "test:concurrency": String(measured.assertions.suites.concurrency),
  "test:gateway": String(measured.assertions.suites.gatewaySecurity),
  "test:security": String(measured.assertions.suites.securityAudit),
  "test:ui": String(measured.assertions.suites.browser),
  "test:razorpay": String(measured.assertions.notExecuted.paymentSandbox),
};

/**
 * Each check is a regex with one capturing group, and the value that group must
 * hold — either a string, or a function of the match for checks whose expected
 * value depends on what matched. `allow` lists other values that are
 * legitimately different — the payment suite's 22, which is real and
 * deliberately not executed, is the main one.
 */
const CHECKS = [
  {
    label: "total assertions",
    expect: String(measured.assertions.total),
    // Was pinned to "N assertions executed", which only ever matched the deck's
    // own wording. "618 automated assertions across six suites" sat in
    // ppt/README.md and "578 executed assertions" in the viva pack, both
    // unnoticed, because neither uses that phrase. Match the noun instead and
    // name the one figure that is legitimately different.
    re: /(\d+)\s+(?:automated\s+|executed\s+)?assertions\b/g,
    allow: [String(measured.assertions.notExecuted.paymentSandbox)],
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
    label: "unique indexes",
    expect: String(measured.schema.uniqueIndexes),
    // The total above was gated; this one only ever appeared in that check's
    // allow list, which lets the number PASS and never checks it. So when
    // payments_invoice_settled_uq took indexes from 137 to 138 and unique
    // indexes from 83 to 84, the gate caught the first and said nothing about
    // the second, and three documents kept saying 83.
    //
    // "unique indexes" is the only phrasing used, and it cannot collide with
    // the total: /(\d+)\s+indexes\b/ does not match "83 unique indexes",
    // because the word sits between the number and the noun.
    re: /(\d+)\s+unique indexes\b/g,
    allow: [],
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
    // "API routes" too: the Pages home counter read "65 API routes" after the
    // count had moved, because the word between number and noun hid it.
    re: /(\d+)\s+(?:(?:API|HTTP|REST)\s+)?(?:routes|endpoints)\b/g,
    allow: [],
  },
  {
    label: "languages",
    expect: String(measured.i18n.locales),
    re: /(\d+)\s+languages\b/g,
    allow: [],
  },
  // ── the individual suites ────────────────────────────────────────────────
  // The total was gated from the start; the six numbers that add up to it were
  // not. DEPLOYMENT.md carried "64 concurrency + 26 gateway" against a 65 and a
  // 27 while the 626 beside it was correct, which is the worst version of this
  // failure: a breakdown that does not sum to a total nobody doubts.
  {
    label: "e2e suite",
    expect: String(measured.assertions.suites.e2e),
    re: /(\d+)\s+(?:e2e|end-to-end)\b/g,
    allow: [],
  },
  {
    label: "concurrency suite",
    expect: String(measured.assertions.suites.concurrency),
    re: /(\d+)\s+concurrency\b/g,
    allow: [],
  },
  {
    label: "gateway-security suite",
    expect: String(measured.assertions.suites.gatewaySecurity),
    re: /(\d+)\s+gateway[ -]security\b/g,
    allow: [],
  },
  {
    label: "security suite",
    expect: String(measured.assertions.suites.securityAudit),
    re: /(\d+)\s+attacks\b/g,
    allow: [ATTACKS_BOTH_SUITES],
  },
  {
    label: "browser suite",
    expect: String(measured.assertions.suites.browser),
    re: /(\d+)\s+browser\b/g,
    allow: [],
  },
  {
    label: "Android runner",
    expect: String(measured.assertions.otherRunners.android),
    // This was written as `(\d+)\s+Android tests`, a phrasing no document
    // actually uses, so the check matched nothing and the count sat ungated
    // exactly like the per-suite numbers did. Both live shapes are anchored to
    // something Android, because a bare "N unit tests" would also match the
    // app's own 108 in CLAIMS-AUDIT.md.
    re: /`android`[^|]*\|[^|]*?(\d+)\s+unit tests|testDebugUnitTest[^(]{0,80}\((\d+)\s*\n?\s*tests?\)/g,
    group: (m) => m[1] ?? m[2],
    allow: [],
  },
  {
    label: "SOS ladder tests",
    expect: String(measured.assertions.otherRunners.sosLadder),
    // The Android TOTAL was gated; the emergency-ladder subset quoted beside it
    // was not, and it went from 18 to 21 with README.md and TESTING.md still
    // saying 18 — the same shape of failure as the ungated per-suite numbers.
    // Anchored to the class or the file rather than to a phrasing, because the
    // two documents word it differently ("`SosLadderTest` is 21 ... tests" and
    // "moved into `SosLadder.kt`, 21 ... tests") and both wrap the line between
    // the number and the word, hence \s+ rather than a space.
    re: /SosLadder(?:Test|\.kt)`?[^\d\n]{0,30}(\d+)\s+tests\b/g,
    allow: [],
  },
  {
    label: "AI runner",
    expect: String(measured.assertions.otherRunners.ai),
    // ENGINEERING-NOTES.md carried "(12, stdlib only)" against a suite that had grown to
    // 39 — nothing was watching this one either.
    re: /unittest discover -s ai\/tests`?[^(\n]{0,20}\((\d+)/g,
    allow: [],
  },
  {
    label: "Android string keys",
    expect: String(measured.i18n.androidKeys),
    // Measured and recorded, but nothing read it back: adding four strings to
    // res/values-*/ took the real count from 90 to 94 while measured.json and
    // TESTING.md both still said 90. The Android TEST count beside it was
    // gated, and was updated in that same change — which is the argument for
    // this entry rather than against it.
    //
    // Anchored to "strings per locale", the one phrasing that states it, and
    // not to a bare number beside "strings": neighbouring rows of the same
    // table count the server and web catalogues.
    //
    // Counts TRANSLATABLE keys, which is what every locale carries. values/
    // holds one more, app_name, marked translatable="false" because the brand
    // is what a user looks for on a home screen. Recount with:
    //   grep -oE 'name="[^"]+"' \
    //     mobile/app/src/main/res/values-hi/strings.xml | sort -u | wc -l
    re: /(\d+)\s+strings per locale/g,
    allow: [],
  },
  {
    label: "suite size in an `npm run` comment",
    expect: (m) => SCRIPT_SIZES[m[1]],
    // Two details this regex got wrong first time round, both worth keeping:
    //   · [a-z0-9], not [a-z] — "test:e2e" has a digit in it, and a
    //     letters-only class backtracks to the bare "test" script and compares
    //     the e2e count against the unit suite's.
    //   · anchored to a line start — a composite command
    //     ("npm run verify && npm run test:e2e  # 108 unit + 191 end-to-end")
    //     pairs the wrong number with the script, so it is left to the prose
    //     checks above, which read both halves correctly.
    re: /^\s*npm run (test(?::[a-z0-9]+)?)\b[^\n#]*#\s*(\d+)/gm,
    group: (m) => m[2],
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
  // The first landing page, from the 52-table build. Never deployed since
  // pages/ replaced it (pages.yml copies only site/*.mp4 from here), so its
  // figures are that build's record, not claims about this one.
  "site/index.html",
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
 * ENGINEERING-NOTES.md explains that '57 tables' and '433 check constraints' were the
 * published mistakes, and a checker that cannot be told so would force the
 * explanation to be deleted. An escape hatch that must be written down beats a
 * check nobody can satisfy.
 */
const IGNORE_MARK = "claims-check:ignore";

function files(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    // .venv and runs/ are not ours to police: a vendored package README or a
    // generated results.csv is not a claim this project makes, and scanning
    // them means a third-party doc that happens to quote one of our numbers
    // fails the build. ai/.venv alone is 649 MB of other people's markdown.
    // .claude/ is agent tooling state (gitignored); its worktrees are whole copies
    // of the repo mid-edit, so scanning them reports another checkout's drift.
    if (["node_modules", ".git", ".claude", "dist", "build", ".idea", "assets",
         ".venv", "venv", "__pycache__", "runs"].includes(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(md|py|html)$/.test(entry)) out.push(p);
  }
  return out;
}

const problems = [];
let scanned = 0;
/** Replace everything but newlines with spaces, so offsets and lines survive. */
const blank = (m) => m.replace(/[^\n]/g, " ");

for (const file of files(ROOT)) {
  const rel = relative(ROOT, file).replaceAll("\\", "/");
  if (EXEMPT_DIRS.some((d) => rel.startsWith(d))) continue;
  if (EXEMPT_FILES.includes(rel)) continue;
  if (EXEMPT_PATTERNS.some((p) => p.test(rel))) continue;
  if (rel.endsWith(".py") && !rel.startsWith("ppt/")) continue;

  // A page states its numbers inside markup - "<div class=v>757</div><div
  // class=k>automated checks" - so tags are blanked (never the newlines, which
  // keep the line numbers true) and the claim is read as the visitor reads it.
  // Pages were not scanned at all until the app's home page was found still
  // saying 626 checks and 64 routes, weeks after every document said otherwise.
  const raw = readFileSync(file, "utf8");
  const text = rel.endsWith(".html")
    ? raw.replace(/<(script|style)\b[^]*?<\/\1>/gi, blank)
         .replace(/<[^>]*>/g, blank).replace(/&[a-z]+;|&#\d+;/g, " ")
    : raw;
  scanned++;

  for (const check of CHECKS) {
    check.re.lastIndex = 0;
    let m;
    while ((m = check.re.exec(text)) !== null) {
      const found = check.group ? check.group(m) : m[1];
      const want = typeof check.expect === "function" ? check.expect(m) : check.expect;
      if (found === undefined || want === undefined) continue;
      if (found === want || check.allow.includes(found)) continue;
      const upto = text.slice(0, m.index);
      const line = upto.split("\n").length;
      // Whole line, so the marker can sit at either end of it.
      const lineText = text.split(/\r?\n/)[line - 1] ?? "";
      if (lineText.includes(IGNORE_MARK)) continue;
      problems.push(
        `${rel}:${line}  ${check.label}: found ${found}, expected ${want}` +
        `\n      ${m[0].trim()}`,
      );
    }
  }
}

if (process.argv.includes("--list")) {
  console.log("Checked against app/docs/measured.json:\n");
  for (const c of CHECKS) {
    const v = typeof c.expect === "function" ? "(per npm script)" : c.expect;
    console.log(`  ${c.label.padEnd(34)} ${v}`);
  }
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
