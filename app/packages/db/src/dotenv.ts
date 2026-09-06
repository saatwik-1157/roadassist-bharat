/**
 * `.env` discovery, shared by everything that boots against this database.
 *
 * The API used to resolve `.env` from `process.cwd()`. That is the repo's app/
 * directory under `npm start`, but the *workspace* directory under
 * `npm run db:migrate` — so a DATABASE_URL set in app/.env was honoured by the
 * API and silently ignored by the migrator and the seeders. Both defaults
 * happened to be identical, so the split would only have surfaced the moment
 * somebody pointed the app at a different database, and then as a mystery
 * rather than an error. Walking up from the working directory finds the same
 * file from either cwd.
 *
 * It lives in this package because this package is what every entry point —
 * the API, the migrator, the seeders, the reset — already loads.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

let loadedFrom: string | null | undefined;

/**
 * Reads the nearest `.env` at or above `from`, without overwriting anything
 * already in the real environment. Idempotent: later calls are no-ops, so any
 * module may call it defensively at import time.
 *
 * @returns the file that was read, or null when there is none (which is a
 *          supported configuration — every setting has a development default).
 */
export function loadDotEnv(from: string = process.cwd()): string | null {
  if (loadedFrom !== undefined) return loadedFrom;

  for (let dir = resolve(from); ; dir = dirname(dir)) {
    let raw: string;
    try {
      raw = readFileSync(resolve(dir, ".env"), "utf8");
    } catch {
      if (dirname(dir) === dir) return (loadedFrom = null);   // filesystem root
      continue;
    }
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      // A real environment variable always beats the file, so CI and container
      // configuration keep the last word.
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
    return (loadedFrom = resolve(dir, ".env"));
  }
}
