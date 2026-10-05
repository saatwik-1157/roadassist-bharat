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
 * A document that records what was true for a given build is history, not a
 * claim: a figure there that no longer matches is not stale, and rewriting it
 * would falsify the record. The RC1 release and verification reports were
 * skipped for that reason until they left the tree on 2026-10-05. If dated
 * evidence is ever added back, exempt it in EXEMPT_DIRS rather than correcting
 * it; that distinction is the one thing to preserve if this script is extended.
 *
 * ── the label is not always beside the number ──────────────────────────────
 * The prose checks read "920 assertions": a number, then the word that says
 * what it counts. A page does not always write it that way. A stat tile puts
 * the number in one element and the label in the next (and the number again
 * in data-count, which is what the visitor actually sees once the counter has
 * animated); a table puts the label in the first cell and the number three
 * cells along; a JS array puts it in a string the tag-blanking used to throw
 * away. Every one of those shapes carried a stale figure while this gate was
 * green, so each now has a reader of its own — see STRUCTURAL CHECKS below.
 * The regression tests are apps/api/test/check-claims.test.ts.
 *
 *   node scripts/check-claims.mjs          # verify
 *   node scripts/check-claims.mjs --list   # show what is being checked
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const APP = join(ROOT, "app");

export const measured = JSON.parse(readFileSync(join(APP, "docs", "measured.json"), "utf8"));

/**
 * Routes under /v1. measured.json recorded only the TOTAL (api.routes) and
 * explained the split in prose, and prose is what went stale: "73 routes, 66
 * of them under /v1" sat in two documents with the 73 gated and the 66 not.
 * The split is now api.underV1, and the documents are held to it like any
 * other figure.
 *
 * Both route figures are also re-derived from the code on every run — the
 * same grep recorded under api.how, and for the split that grep narrowed to a
 * first argument starting with /v1 — because api.how says of the split
 * "Re-derive it; never assume it", and a gate is the only thing that does so
 * every time. A mismatch there is reported against measured.json itself: the
 * documents are compared with the file, the file with the code.
 */
const ROUTE_CALL = /\bapp\.(?:get|post|put|patch|delete)\(/g;
const V1_ROUTE_CALL = /\bapp\.(?:get|post|put|patch|delete)\(\s*["'`]\/v1(?=[/"'`])/g;
function countCalls(re, dir) {
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) n += countCalls(re, p);
    else if (/\.ts$/.test(entry)) n += (readFileSync(p, "utf8").match(re) ?? []).length;
  }
  return n;
}
const API_SRC = join(APP, "apps", "api", "src");
export const countRoutes = (dir = API_SRC) => countCalls(ROUTE_CALL, dir);
export const countV1Routes = (dir = API_SRC) => countCalls(V1_ROUTE_CALL, dir);
export const UNDER_V1 = String(measured.api.underV1);

/** "Twelve ADRs" is written as often as "12 ADRs". */
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const WORD_ALT = Object.keys(NUMBER_WORDS).join("|");
const asDigits = (s) => (s === undefined ? undefined
  : /^\d/.test(s) ? s.replaceAll(",", "") : String(NUMBER_WORDS[s.toLowerCase()]));

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
    // Not when "under /v1" follows: "64 endpoints under /v1" is the split, and
    // the check below reads it against the right number.
    re: /(\d+)\s+(?:(?:API|HTTP|REST)\s+)?(?:routes|endpoints)\b(?!\s+under\s+`?\/v1)/g,
    allow: [],
  },
  {
    label: "routes under /v1",
    expect: UNDER_V1,
    // The total was gated; the split beside it never was, so "73 routes, 66 of
    // them under /v1" passed. The shapes in use: "70 under /v1", "(70 under
    // `/v1`)", "66 of them under /v1", "65 of them under a versioned /v1" and
    // "64 endpoints under /v1". Expected value is api.underV1 — see UNDER_V1.
    re: /\b(\d+)\s+(?:of\s+(?:them|those|these|the\s+\d+(?:\s+routes)?)\s+)?(?:(?:API|HTTP)\s+)?(?:(?:routes|endpoints)\s+)?(?:are\s+)?under\s+(?:(?:a|the)\s+versioned\s+)?`?\/v1\b/g,
    allow: [],
  },
  {
    label: "ADRs",
    expect: String(measured.adrs),
    // measured.json has recorded the ADR count since it was created and nothing
    // read it. Written in digits ("12 ADRs") and in words ("Twelve decision
    // records", "Twelve architecture decision records"), so both are matched
    // and the word is converted before comparing.
    re: new RegExp(`\\b(\\d+|${WORD_ALT})\\s+(?:architecture\\s+)?(?:ADRs|decision\\s+records)\\b`, "gi"),
    group: (m) => asDigits(m[1]),
    allow: [],
  },
  {
    label: "not part of the total",
    expect: String(measured.assertions.total),
    // "Run separately — not part of the 920" heads the Android and payment rows
    // on the Pages evidence table. It names the total without the word
    // "assertions", so the total check never saw it.
    re: /\bnot\s+(?:part\s+of|in|counted\s+in|included\s+in)\s+the\s+(\d+)\b(?!\s*(?:%|[a-z]))/g,
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
    // "refused" and "self-written" too: the Pages meta description said "84
    // refused attacks" and the attack pack "74 self-written attacks", and the
    // adjective between number and noun hid both, as "API" once hid the routes.
    re: /(\d+)\s+(?:refused\s+|self-written\s+)?attacks\b/g,
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
    label: "Android runner (prose)",
    expect: String(measured.assertions.otherRunners.android),
    // "Native Kotlin + Jetpack Compose client with 87 unit tests" sat in the
    // layers page's component list at a third of the real count. Anchored to
    // Android or Kotlin earlier in the same sentence (no full stop, digit or
    // table bar between), because a bare "N unit tests" is also the app's own
    // suite.
    re: /\b(?:Android|Kotlin)\b[^.\n\d|]{0,60}?\b(\d+)\s+(?:Kotlin\s+)?unit\s+tests\b/g,
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
 * Some files legitimately hold a number that is not today's.
 *
 * THE REVIEW-1 DECK — ppt/part_[a-g].py and review1-ppt. Superseded; only
 * part_final.py builds the current deck. The audit that quotes the corrected
 * figures, and the first landing page, are named in EXEMPT_FILES below.
 *
 * Until 2026-10-05 this list also exempted the RC1 dated evidence
 * (docs/release, docs/verification), the 18-phase plan (docs/00..05-*.md) and
 * review-plan/. Those were removed from the tree and stay in git history.
 */
const EXEMPT_DIRS = ["review1-ppt"];
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

/**
 * Attributes a visitor reads, so a figure in one is a claim like any other —
 * a screenshot's caption included.
 *
 * The Pages gallery shows each screenshot's `data-cap` beneath it in the
 * lightbox: "The security suite — N attacks, every one refused". That caption
 * used to be exempt, on the argument that it describes a capture of one run
 * and stays true of the picture when the suite grows. In practice it meant the
 * showcase said "56 tables" and "87 attacks" under the headline gallery long
 * after the schema had 58 and the suite 106, and nothing noticed — the image
 * was just as stale as its caption, and the visitor reads both as today's
 * system. So the caption is read like body text: when a number moves, the
 * build fails until the screenshot is re-taken and its caption updated
 * TOGETHER. A caption that must name a past figure on purpose takes
 * claims-check:ignore on its line, like any other quotation.
 *
 * figcaption needs no reader of its own: it is element text, and element text
 * is what the prose checks already read once the tags are blanked.
 */
const VISIBLE_ATTR = /(?<=\s)(alt|title|aria-label|content|placeholder|data-cap)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

export function isExempt(rel) {
  if (EXEMPT_DIRS.some((d) => rel.startsWith(d))) return true;
  if (EXEMPT_FILES.includes(rel)) return true;
  if (EXEMPT_PATTERNS.some((p) => p.test(rel))) return true;
  if (rel.endsWith(".py") && !rel.startsWith("ppt/")) return true;
  return false;
}

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

/** Replace everything but newlines with spaces, so offsets and lines survive. */
const blank = (m) => m.replace(/[^\n]/g, " ");

/**
 * An inline script, reduced to the contents of its string literals.
 *
 * Scripts used to be blanked whole, which is how the layers page's component
 * list kept "87 unit tests" and the Pages FAQ "68 routes, 65 of them under a
 * versioned /v1": both are string literals in an array, shown to every
 * visitor, and invisible to a checker that threw the script away. Code and
 * comments are still blanked — only what the page can print is read.
 */
const JS_TOKEN = /\/\/[^\n]*|\/\*[^]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
function jsStrings(code) {
  let out = "";
  let last = 0;
  for (const m of code.matchAll(JS_TOKEN)) {
    out += blank(code.slice(last, m.index));
    const t = m[0];
    // An escape becomes spaces of its own length: the escape for an em dash,
    // backslash-u-2014, must not leave a bare 2014 behind for the checks.
    out += t[0] === "/" ? blank(t)
      : " " + t.slice(1, -1).replace(/\\u\{[0-9a-f]+\}|\\u[0-9a-f]{4}|\\x[0-9a-f]{2}|\\./gi, blank) + " ";
    last = m.index + t.length;
  }
  return out + blank(code.slice(last));
}

/** A tag, blanked except for the values of the attributes a visitor reads. */
function tagText(tag) {
  let out = blank(tag);
  for (const a of tag.matchAll(VISIBLE_ATTR)) {
    const val = a[2] ?? a[3];
    const at = a.index + a[0].length - val.length - 1;
    out = out.slice(0, at) + val + out.slice(at + val.length);
  }
  return out;
}

/**
 * The text the prose checks read. Markdown and Python as written; a page as the
 * visitor reads it.
 *
 * A page states its numbers inside markup - "<div class=v>757</div><div
 * class=k>automated checks" - so tags are blanked (never the newlines, which
 * keep the line numbers true) and the claim is read as the visitor reads it.
 * Pages were not scanned at all until the app's home page was found still
 * saying 626 checks and 64 routes, weeks after every document said otherwise.
 */
export function visibleText(rel, raw) {
  if (!rel.endsWith(".html")) return raw;
  return raw
    .replace(/(<script\b[^>]*>)([^]*?)(<\/script>)/gi, (_, open, body, close) =>
      blank(open) + jsStrings(body) + blank(close))
    .replace(/<style\b[^]*?<\/style>/gi, blank)
    .replace(/<!--[^]*?-->/g, blank)
    .replace(/<[^>]*>/g, tagText)
    .replace(/&[a-z]+;|&#\d+;/g, " ");
}

// ── STRUCTURAL CHECKS ─────────────────────────────────────────────────────────
// For figures whose label is not the next word. Each reads the raw file, finds
// the label in its own element or cell, and compares the number that belongs
// to it.

const S = String;
const SUITES = measured.assertions.suites;
const RUNNERS = measured.assertions.otherRunners;

/**
 * What a stat tile's label names. Matched against the START of the label
 * element's text, case-insensitively: tiles capitalise ("Assertions",
 * "Tables") and the prose checks, which are case-sensitive on purpose, never
 * saw them.
 */
const TILE_LABELS = [
  { label: "total assertions", re: /^(?:automated\s+|executed\s+)?(?:assertions|checks)\b/i, expect: S(measured.assertions.total) },
  { label: "unique indexes", re: /^unique\s+indexes\b/i, expect: S(measured.schema.uniqueIndexes) },
  { label: "indexes", re: /^indexes\b/i, expect: S(measured.schema.indexes) },
  { label: "application tables", re: /^(?:database\s+|application\s+)?tables\b/i, expect: S(measured.schema.tables) },
  { label: "foreign keys", re: /^(?:foreign\s+keys|FKs)\b/i, expect: S(measured.schema.foreignKeys) },
  { label: "check constraints", re: /^check\s+constraints\b/i, expect: S(measured.schema.checkConstraints) },
  { label: "migrations", re: /^migrations\b/i, expect: S(measured.schema.migrations) },
  { label: "routes", re: /^(?:(?:API|HTTP|REST)\s+)?(?:routes|endpoints)\b/i, expect: S(measured.api.routes) },
  { label: "languages", re: /^(?:languages|locales)\b/i, expect: S(measured.i18n.locales) },
  { label: "ADRs", re: /^(?:ADRs|(?:architecture\s+)?decision\s+records)\b/i, expect: S(measured.adrs) },
  { label: "security suite", re: /^(?:refused\s+)?attacks\b/i, expect: S(SUITES.securityAudit), allow: [ATTACKS_BOTH_SUITES] },
  { label: "Android runner", re: /^(?:Android|Kotlin)\s+(?:unit\s+)?tests\b/i, expect: S(RUNNERS.android) },
];

/**
 * A number alone in an element, then the label in the next element:
 *   <div class="v" data-count="920">920</div><div class="l">Assertions</div>
 * The number may be wrapped once in strong/b/span and may carry a trailing +.
 */
const TILE = /<([a-z][a-z0-9]*)\b([^>]*)>\s*(?:<(?:strong|b|span)\b[^>]*>\s*)?(\d[\d,]*)\+?\s*(?:<\/(?:strong|b|span)>\s*)?<\/\1>\s*<[a-z][a-z0-9]*\b[^>]*>\s*([^<]{1,80})/gi;
const DATA_COUNT = /\bdata-count\s*=\s*["']?(\d[\d,]*)/i;

/**
 * What a table row's FIRST cell names. The cell must be the suite and nothing
 * else, bar a qualifier: "Security (attacks that must fail)", "Browser /
 * offline", "Concurrency + real-time", "`npm test` (node:test)". So "Security
 * headers" and "AI Gateway" are not suites, and a row that merely mentions a
 * suite script in a later cell is not read at all.
 */
const ROW_END = String.raw`(?=\s*$|\s*[(+/—–,·]|\s+-\s|\s+(?:tests?|suite|assertions|checks)\b)`;
const row = (label, alternatives, expect) =>
  ({ label, re: new RegExp(`^(?:${alternatives})${ROW_END}`, "i"), expect: S(expect) });
const ROW_LABELS = [
  row("unit suite", String.raw`unit|npm test|npm run test`, SUITES.unit),
  row("e2e suite", String.raw`end-to-end|e2e|e2e-journey\.mjs|npm run test:e2e`, SUITES.e2e),
  row("concurrency suite", String.raw`concurrency|concurrency-test\.mjs|npm run test:concurrency`, SUITES.concurrency),
  row("gateway-security suite", String.raw`gateway[ -]security|gateway-security-test\.mjs|npm run test:gateway`, SUITES.gatewaySecurity),
  row("security suite", String.raw`security(?: audit)?|security-audit\.mjs|npm run test:security`, SUITES.securityAudit),
  row("browser suite", String.raw`browser|ui-journey\.mjs|npm run test:ui`, SUITES.browser),
  row("total assertions", String.raw`total`, measured.assertions.total),
  row("Android runner", String.raw`android`, RUNNERS.android),
  row("SOS ladder tests", String.raw`SOS ladder|SosLadderTest(?:\.kt)?`, RUNNERS.sosLadder),
  row("AI runner", String.raw`CV pipeline`, RUNNERS.ai),
  row("payment sandbox", String.raw`razorpay sandbox|payment sandbox|razorpay-test\.mjs|npm run test:razorpay`,
    measured.assertions.notExecuted.paymentSandbox),
];

/** A cell as its label reads: no markup, emphasis, code ticks or scripts/ prefix. */
const cellText = (c) => c
  .replace(/<[^>]*>/g, " ").replace(/&[a-z]+;|&#\d+;/g, " ")
  .replace(/\*\*|__|`/g, "")
  .replace(/\s+/g, " ").trim()
  .replace(/^(?:app\/)?scripts\//, "");

/**
 * Which column holds the count. Only a table whose header names one is read:
 * a marks rubric ("| Security | 10 | 8–9 |") has a suite in its first column
 * and a number beside it that has nothing to do with the suite's size.
 */
const COUNT_HEADER = /^(?:assertions|tests|checks|count|attacks|cases|size)\b/i;
const countColumn = (header) => header.findIndex((h, i) => i > 0 && COUNT_HEADER.test(cellText(h)));

/** The cell's figure, if it is a bare number or starts with a bold one ("**22** — not in the 920"). */
function cellNumber(c) {
  if (c === undefined) return undefined;
  const bare = cellText(c).match(/^(\d[\d,]*)$/);
  if (bare) return bare[1];
  return c.trim().match(/^\*\*(\d[\d,]*)\*\*(?!\S)/)?.[1];
}

const lineAt = (s, i) => s.slice(0, i).split("\n").length;
const clip = (s) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > 140 ? t.slice(0, 137) + "..." : t; };

/** Every structural finding in one file, as [index, label, found, want, allow, snippet]. */
function structural(rel, raw) {
  const out = [];
  const classify = (list, s) => list.find((l) => l.re.test(s));

  if (rel.endsWith(".html")) {
    // (1) stat tiles, and the data-count the counter animates to
    TILE.lastIndex = 0;
    let m;
    while ((m = TILE.exec(raw)) !== null) {
      const label = m[4].replace(/&[a-z]+;|&#\d+;/g, " ").trim();
      const kind = classify(TILE_LABELS, label);
      if (!kind) continue;
      const dc = m[2].match(DATA_COUNT);
      if (dc) out.push([m.index, `stat tile data-count: ${kind.label}`, dc[1], kind.expect, kind.allow, m[0]]);
      // A counter may start from 0 and animate to data-count; that 0 is not a claim.
      if (!(dc && m[3] === "0")) out.push([m.index, `stat tile: ${kind.label}`, m[3], kind.expect, kind.allow, m[0]]);
    }
    // (2) HTML table rows. The header is the first row; the count column is
    // the one it names. Rows are read from each <table> separately so one
    // table's header never applies to another's rows.
    for (const table of raw.matchAll(/<table\b[^>]*>([^]*?)<\/table>/gi)) {
      const base = table.index + table[0].indexOf(table[1]);
      let col = -1;
      let first = true;
      for (const tr of table[1].matchAll(/<tr\b[^>]*>([^]*?)<\/tr>/gi)) {
        const cells = [...tr[1].matchAll(/<(t[dh])\b[^>]*>([^]*?)<\/\1>/gi)].map((c) => c[2]);
        if (first) { col = countColumn(cells); first = false; continue; }
        if (col < 0) break;
        const kind = classify(ROW_LABELS, cellText(cells[0] ?? ""));
        if (!kind) continue;
        const n = cellNumber(cells[col]);
        if (n !== undefined) out.push([base + tr.index, `table row: ${kind.label}`, n, kind.expect, [], tr[0]]);
      }
    }
  }

  if (rel.endsWith(".md")) {
    // (2) Markdown table rows. A table is a run of |-lines; its first line is
    // the header, and names the count column.
    let at = 0;
    let col = -1;
    let inTable = false;
    for (const line of raw.split("\n")) {
      const here = at;
      at += line.length + 1;
      if (!/^\s*\|.*\|\s*$/.test(line)) { inTable = false; continue; }
      const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/);
      if (!inTable) { inTable = true; col = countColumn(cells); continue; }
      if (col < 0 || /^[\s|:-]+$/.test(line)) continue;
      const kind = classify(ROW_LABELS, cellText(cells[0]));
      if (!kind) continue;
      const n = cellNumber(cells[col]);
      if (n !== undefined) out.push([here, `table row: ${kind.label}`, n, kind.expect, [], line]);
    }
  }
  return out;
}

/**
 * Every disagreement in one file: [{ rel, line, label, found, want, snippet }].
 * The file is not checked for exemption here — see isExempt — so a test can
 * hand it any path.
 */
export function checkFile(rel, raw) {
  const text = visibleText(rel, raw);
  const rawLines = raw.split(/\r?\n/);
  const problems = [];
  const seen = new Set();
  // `src` is the string `index` is an offset into: the visible text for the
  // prose checks (entities shrink it, so its offsets are not the file's), the
  // file itself for the structural ones. Both keep every newline.
  const report = (src, index, label, found, want, allow, snippet) => {
    if (found === undefined || want === undefined) return;
    found = found.replaceAll(",", "");
    if (found === want || (allow ?? []).includes(found)) return;
    const line = lineAt(src, index);
    // Whole line of the SOURCE, so the marker can sit at either end of it and
    // may be an HTML comment (which the visible text no longer contains).
    if ((rawLines[line - 1] ?? "").includes(IGNORE_MARK)) return;
    // A tile's "73 ... API routes" is also a prose match; say it once.
    const key = `${line}:${found}:${want}`;
    if (seen.has(key)) return;
    seen.add(key);
    problems.push({ rel, line, label, found, want, snippet: clip(snippet) });
  };

  for (const check of CHECKS) {
    // With indices, so a problem is reported on the NUMBER's line: an anchor
    // such as "Android app" can sit on the line above it.
    const re = new RegExp(check.re.source, check.re.flags.replace("d", "") + "d");
    let m;
    while ((m = re.exec(text)) !== null) {
      const found = check.group ? check.group(m) : m[1];
      const want = typeof check.expect === "function" ? check.expect(m) : check.expect;
      const at = m.indices.slice(1).find(Boolean)?.[0] ?? m.index;
      report(text, at, check.label, found, want, check.allow, m[0]);
    }
  }
  for (const [index, label, found, want, allow, snippet] of structural(rel, raw)) {
    report(raw, index, label, found, want, allow, snippet);
  }
  return problems;
}

/**
 * measured.json's route figures against the code they count. Takes the
 * figures and the source directory so a test can hand it both.
 */
export function measuredVsCode(api = measured.api, dir = API_SRC) {
  const rel = "app/docs/measured.json";
  const lines = readFileSync(join(APP, "docs", "measured.json"), "utf8").split(/\r?\n/);
  const lineOf = (key) => lines.findIndex((l) => l.includes(`"${key}"`)) + 1;
  const out = [];
  for (const [key, label, counted] of [
    ["routes", "api.routes vs the code", countRoutes(dir)],
    ["underV1", "api.underV1 vs the code", countV1Routes(dir)],
  ]) {
    if (String(api[key]) === String(counted)) continue;
    out.push({ rel, line: lineOf(key), label, found: String(api[key]), want: String(counted),
      snippet: `apps/api/src has ${counted}; re-measure (api.how) and update measured.json, then the documents` });
  }
  return out;
}

/** The whole tree: every file that is not exempt. */
export function scan(root = ROOT) {
  const problems = [...measuredVsCode()];
  let scanned = 0;
  for (const file of files(root)) {
    const rel = relative(root, file).replaceAll("\\", "/");
    if (isExempt(rel)) continue;
    scanned++;
    problems.push(...checkFile(rel, readFileSync(file, "utf8")));
  }
  return { problems, scanned };
}

function main() {
  if (process.argv.includes("--list")) {
    console.log("Checked against app/docs/measured.json:\n");
    for (const c of CHECKS) {
      const v = typeof c.expect === "function" ? "(per npm script)" : c.expect;
      console.log(`  ${c.label.padEnd(34)} ${v}`);
    }
    console.log("\nStat tiles (number, then the label in the next element; and data-count):");
    for (const t of TILE_LABELS) console.log(`  ${t.label.padEnd(34)} ${t.expect}`);
    console.log("\nTable rows, HTML and Markdown (first cell names the suite):");
    for (const r of ROW_LABELS) console.log(`  ${r.label.padEnd(34)} ${r.expect}`);
    console.log(`\nmeasured.json against apps/api/src, counted on each run:`);
    console.log(`  ${"api.routes".padEnd(34)} ${measured.api.routes} recorded, ${countRoutes()} in the code`);
    console.log(`  ${"api.underV1".padEnd(34)} ${measured.api.underV1} recorded, ${countV1Routes()} in the code`);
    console.log(`Exempt directories: ${EXEMPT_DIRS.join(", ")}`);
    console.log(`Read as text: element text (figcaption included) and the attributes ${VISIBLE_ATTR.source.match(/\(([a-z|-]+)\)/)[1].split("|").join(", ")}`);
    process.exit(0);
  }

  const { problems, scanned } = scan();
  if (problems.length) {
    console.error(`✗ ${problems.length} claim(s) disagree with app/docs/measured.json:\n`);
    for (const p of problems) {
      console.error(`  ${p.rel}:${p.line}  ${p.label}: found ${p.found}, expected ${p.want}` +
        `\n        ${p.snippet}\n`);
    }
    console.error(
      "Either the documents are stale, or measured.json is — re-measure with the\n" +
      "commands recorded in that file, then update whichever is wrong.\n",
    );
    process.exit(1);
  }

  console.log(`✓ claims consistent across ${scanned} files`);
}

// Run only when invoked directly; the regression tests import the functions.
const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
if (invoked.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) main();
