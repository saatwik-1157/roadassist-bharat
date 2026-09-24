#!/usr/bin/env node
/**
 * Citation fitness function — a `file.ts:123` in the documents must still point
 * at something.
 *
 * ── why this exists ────────────────────────────────────────────────────────
 * `check-claims.mjs` made the NUMBERS mechanical. The line numbers were left to
 * care, and care lost the same way it always does. Lifting the auth and
 * emergency routes out of `server.ts` shifted every citation below them:
 *
 *   server.ts:2654  "POST /v1/sos/offline-sync"   → past the end of a 2,520-line file
 *   server.ts:2350  "POST /v1/sos"                → a SQL fragment about mechanic bookings
 *   server.ts:1262  "POST /v1/bookings/:id/pay"   → a blank line
 *   server.ts:832   "bookingAudience()"           → the middle of an unrelated reduce
 *
 * These live in `docs/viva/CODE_TO_VIVA_MAP.md` and `FINAL_PROFESSOR_DEFENSE.md`,
 * whose whole instruction to the reader is *"open the file, do not describe it"*.
 * A stale line number there is found by opening it in front of an examiner.
 *
 * ── what it can and cannot check ───────────────────────────────────────────
 * It cannot know that line 719 is `bookingAudience`. It can know that the file
 * exists, that the line exists, and that the line is not blank or a bare closing
 * brace — which is what a citation decays into once the code above it moves, and
 * which caught four of the ten that had already rotted. Re-derive by grepping
 * for the route or the function, never by nudging the number.
 *
 *   node scripts/check-citations.mjs          # verify
 *   node scripts/check-citations.mjs --list   # show every citation and its line
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const APP = join(ROOT, "app");

/** `some/path/file.ext:123`, the shape every citation in these documents uses. */
const CITATION = /((?:[\w.-]+\/)+[\w.-]+\.(?:ts|kt|mjs|js|py|sql|kts|xml|html)):(\d+)/g;

/**
 * The same thing written with NO directory: `server.ts:1431`.
 *
 * CITATION requires at least one slash, so these were invisible to this
 * checker — and that is exactly where the rot survived. Three of them had
 * gone stale while `npm run citations` stayed green: `server.ts:1431` was
 * cited by two documents as the payment webhook and is the star-rating Zod
 * schema in POST /v1/bookings/:id/review, and `server.ts:1057` was cited as
 * `SELECT … FOR UPDATE` and is a service-types lookup. Both live in the viva
 * packs, whose instruction to the reader is *open the file*.
 *
 * A bare name cannot be resolved reliably — basenames repeat across the four
 * toolchains here — so this does not try. It refuses the SHAPE, and the fix is
 * to write the repository path so the check above can do its job.
 */
const BARE_CITATION = /(?:^|[^\w./-])([\w-]+\.(?:ts|kt|mjs|js|py|sql|kts)):(\d+)/g;

/**
 * Dated evidence, the plan, and the superseded deck — the same exemptions
 * `check-claims.mjs` carries, and for the same reason. See its header.
 */
const EXEMPT_DIRS = ["docs/release", "docs/verification", "review1-ppt", "review-plan"];
const IGNORE_MARK = "citation-check:ignore";

/**
 * A citation that lands here is not a citation any more. Blank lines and bare
 * closing punctuation are what a line number decays into when the code above it
 * moves — no document ever means to point at one.
 */
const isDeadAnchor = (line) => line.trim() === "" || /^[)\]};,\s]*$/.test(line);

/** Documents cite from the repository root or from `app/`; try both. */
function resolve(cited) {
  for (const base of [ROOT, APP]) {
    const p = join(base, cited);
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

/**
 * Every source basename in the repository, and where it lives.
 *
 * Used only to tell a citation from an illustration. ENGINEERING-NOTES.md and
 * TESTING.md both explain the rule with a literal `file.ts:123`, which must
 * not fail the build — and does not, because no file.ts exists. A bare name
 * is only refused when a real file could have been meant.
 */
function sourceIndex(dir, out = new Map()) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".git", ".claude", "dist", "build", ".idea", ".venv", "venv",
         "runs", "data", "__pycache__", ".gradle", ".kotlin"].includes(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sourceIndex(p, out);
    else if (/\.(ts|kt|mjs|js|py|sql|kts)$/.test(entry)) {
      if (!out.has(entry)) out.set(entry, []);
      out.get(entry).push(relative(ROOT, p).replaceAll("\\", "/"));
    }
  }
  return out;
}

function markdownFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".git", ".claude", "dist", "build", ".idea", "assets", "runs"].includes(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) markdownFiles(p, out);
    else if (entry.endsWith(".md")) out.push(p);
  }
  return out;
}

const SOURCES = sourceIndex(ROOT);

const problems = [];
const listed = [];
let checked = 0;

for (const file of markdownFiles(ROOT)) {
  const rel = relative(ROOT, file).replaceAll("\\", "/");
  if (EXEMPT_DIRS.some((d) => rel.startsWith(d))) continue;

  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);

  /**
   * A second file/line pair on the same row, written as shorthand: 
   * `apps/api/src/audit.ts:83` / `:122`. It inherits the file from the
   * citation before it, which is readable — and was invisible to every check
   * here, so `:122` went on claiming verifyAuditChain() after that function
   * moved to 148 and `:1318` went on claiming the Razorpay webhook after it
   * moved to 1440. Both landed on real code, so nothing complained.
   *
   * Resolved the way a reader resolves it: against the nearest full citation
   * earlier on the SAME line. A shorthand with nothing before it is not a
   * citation, it is a time or a page number, and is left alone.
   */
  lines.forEach((lineText, i) => {
    if (lineText.includes(IGNORE_MARK)) return;
    const full = [...lineText.matchAll(/((?:[\w.-]+\/)+[\w.-]+\.(?:ts|kt|mjs|js|py|sql|kts|xml|html)):(\d+)/g)];
    if (full.length === 0) return;
    for (const sh of lineText.matchAll(/`:(\d+)`/g)) {
      const owner = full.filter((f) => f.index < sh.index).pop();
      if (!owner) continue;
      const cited = owner[1];
      const target = resolve(cited);
      if (target === null) continue;   // the full citation already reported it
      const body = readFileSync(target, "utf8").split(/\r?\n/);
      const n = Number(sh[1]);
      checked++;
      if (n > body.length) {
        problems.push(`${rel}:${i + 1}  ${cited}:${n} (written \`:${n}\`) — file has only ${body.length} lines`);
      } else if (isDeadAnchor(body[n - 1])) {
        problems.push(`${rel}:${i + 1}  ${cited}:${n} (written \`:${n}\`) — lands on a blank line or a bare closing brace`);
      } else {
        listed.push(`  ${(cited + ":" + n).padEnd(46)} ${body[n - 1].trim().slice(0, 70)}`);
      }
    }
  });

  // Refuse a citation nothing can check before checking the ones we can.
  BARE_CITATION.lastIndex = 0;
  let b;
  while ((b = BARE_CITATION.exec(text)) !== null) {
    const [, name, lineNo] = b;
    const at = text.slice(0, b.index).split("\n").length;
    if ((lines[at - 1] ?? "").includes(IGNORE_MARK)) continue;
    const where = SOURCES.get(name);
    if (!where) continue;   // no such file: an illustration, not a citation
    problems.push(
      `${rel}:${at}  ${name}:${lineNo} — written with no path, so nothing checks it.` +
      ` Write it as ${where[0]}:${lineNo}` +
      (where.length > 1 ? ` (or one of ${where.length} files named ${name})` : ""),
    );
  }

  CITATION.lastIndex = 0;
  let m;
  while ((m = CITATION.exec(text)) !== null) {
    const [, cited, lineNo] = m;
    const at = text.slice(0, m.index).split("\n").length;
    if ((lines[at - 1] ?? "").includes(IGNORE_MARK)) continue;

    checked++;
    const target = resolve(cited);
    if (target === null) {
      problems.push(`${rel}:${at}  ${cited}:${lineNo} — no such file`);
      continue;
    }

    const body = readFileSync(target, "utf8").split(/\r?\n/);
    const n = Number(lineNo);
    if (n > body.length) {
      problems.push(`${rel}:${at}  ${cited}:${lineNo} — file has only ${body.length} lines`);
      continue;
    }
    if (isDeadAnchor(body[n - 1])) {
      problems.push(
        `${rel}:${at}  ${cited}:${lineNo} — lands on a blank line or a bare closing brace,` +
        ` which means the code it named has moved`,
      );
      continue;
    }
    listed.push(`  ${(cited + ":" + lineNo).padEnd(46)} ${body[n - 1].trim().slice(0, 70)}`);
  }
}

if (process.argv.includes("--list")) {
  console.log(`${checked} citation(s):\n`);
  listed.forEach((l) => console.log(l));
  process.exit(0);
}

if (problems.length) {
  console.error(`✗ ${problems.length} citation(s) no longer point at code:\n`);
  problems.forEach((p) => console.error("  " + p + "\n"));
  console.error(
    "Re-derive them by grepping for the route or the function — never by nudging\n" +
    "the number. A line that merely exists is not the line that was meant.\n",
  );
  process.exit(1);
}

console.log(`✓ ${checked} code citations still resolve`);
