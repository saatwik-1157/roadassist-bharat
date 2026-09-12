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

function markdownFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".git", "dist", "build", ".idea", "assets", "runs"].includes(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) markdownFiles(p, out);
    else if (entry.endsWith(".md")) out.push(p);
  }
  return out;
}

const problems = [];
const listed = [];
let checked = 0;

for (const file of markdownFiles(ROOT)) {
  const rel = relative(ROOT, file).replaceAll("\\", "/");
  if (EXEMPT_DIRS.some((d) => rel.startsWith(d))) continue;

  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);

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
