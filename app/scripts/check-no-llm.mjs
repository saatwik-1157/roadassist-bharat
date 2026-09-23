#!/usr/bin/env node
/**
 * The system contains no LLM, and this is what keeps it that way.
 *
 * "AI-assisted" is a claim a reviewer is right to distrust, because it is
 * usually a thin wrapper around somebody else's chat endpoint. Two things are
 * true here and both are checkable:
 *
 *   * RAKSHA road-damage detection is a YOLO11 model trained on RDD2022 in
 *     this repository. The training script, the dataset manifest and the
 *     per-epoch metrics are all under ai/.
 *   * The roadside diagnosis is a deterministic rule table (ADR-0006) that
 *     returns `rules-1.0.0`. It is labelled as a rules engine on every screen
 *     that shows it.
 *
 * Neither is a language model, and nothing in the running system calls one.
 * That is an architectural property, not a coincidence, so it is enforced:
 * add an LLM SDK to a manifest, or call a chat endpoint from any source file,
 * and the build fails here.
 *
 * This gate reasons about DEPENDENCIES and ENDPOINTS, never about prose. The
 * documents are free to discuss language models; the software may not depend
 * on one.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, basename, sep } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SELF = "check-no-llm.mjs";

/** Directories that are vendored, generated or gitignored — not our code. */
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".venv", "venv", "__pycache__", "build", "dist",
  ".gradle", ".idea", "runs", "outputs", "weights", "datasets", ".next",
  "coverage", "test-results", "presentation",
]);

/** Packages that exist to talk to a language model. */
const LLM_PACKAGES = [
  "openai", "@anthropic-ai/sdk", "anthropic", "langchain", "@langchain/core",
  "llamaindex", "llama-cpp-python", "cohere-ai", "cohere", "mistralai",
  "google-generativeai", "@google/generative-ai", "huggingface_hub",
  "@huggingface/inference", "ollama", "replicate", "together-ai", "groq",
];

/** Endpoints and model identifiers that only a language model call carries. */
const LLM_ENDPOINTS = [
  /api\.openai\.com/i,
  /api\.anthropic\.com/i,
  /generativelanguage\.googleapis\.com/i,
  /api\.cohere\.(ai|com)/i,
  /api\.mistral\.ai/i,
  /openrouter\.ai/i,
  /api\.groq\.com/i,
  /\/v1\/chat\/completions/i,
  /\bgpt-(?:3\.5|4|4o|5)\b/i,
  /\bclaude-[0-9]/i,
  /\bgemini-(?:pro|1\.5|2)/i,
];

const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".kt", ".kts", ".py"]);
const MANIFESTS = new Set(["package.json", "requirements.txt", "requirements-dev.txt", "pyproject.toml"]);

const violations = [];

/** Walk the tree once, handing every file we care about to the right check. */
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { walk(full); continue; }
    if (entry === SELF) continue;

    const rel = relative(ROOT, full).split(sep).join("/");
    if (MANIFESTS.has(entry)) checkManifest(full, rel);
    const dot = entry.lastIndexOf(".");
    if (dot > 0 && SOURCE_EXT.has(entry.slice(dot))) checkSource(full, rel);
  }
}

/** A declared dependency is the strongest evidence, so it is checked by name. */
function checkManifest(full, rel) {
  const text = readFileSync(full, "utf8");
  if (basename(full) === "package.json") {
    let pkg;
    try { pkg = JSON.parse(text); } catch { return; }
    const deps = Object.keys({
      ...pkg.dependencies, ...pkg.devDependencies,
      ...pkg.peerDependencies, ...pkg.optionalDependencies,
    });
    for (const d of deps) {
      if (LLM_PACKAGES.includes(d)) violations.push(`${rel}: declares LLM dependency "${d}"`);
    }
    return;
  }
  // requirements.txt / pyproject.toml — compare the bare package name only, so
  // a comment mentioning a model does not trip the gate.
  text.split(/\r?\n/).forEach((line, i) => {
    const bare = line.split("#")[0].trim().split(/[<>=!~[ ]/)[0].toLowerCase();
    if (bare && LLM_PACKAGES.includes(bare)) {
      violations.push(`${rel}:${i + 1}: declares LLM dependency "${bare}"`);
    }
  });
}

/** An endpoint in source is the other way an LLM gets in. */
function checkSource(full, rel) {
  const text = readFileSync(full, "utf8");
  text.split(/\r?\n/).forEach((line, i) => {
    for (const re of LLM_ENDPOINTS) {
      if (!re.test(line)) continue;
      // One report per line: a chat URL usually matches the host pattern and
      // the path pattern both, and two lines of output for one defect reads
      // like two defects.
      violations.push(`${rel}:${i + 1}: calls a language model — ${line.trim().slice(0, 80)}`);
      break;
    }
  });
}

walk(ROOT);

if (violations.length) {
  console.error("✗ a language model has entered the system:\n");
  for (const v of violations) console.error(`  ${v}`);
  console.error(`
The AI in this project is a trained YOLO11 detector plus a deterministic rule
table. If a language model is genuinely wanted, it needs an ADR first, and the
claim in README.md and app/docs/CLAIMS-AUDIT.md has to change with it.`);
  process.exit(1);
}

console.log("✓ no LLM dependency or endpoint — AI is a trained YOLO11 model and a rules engine");
