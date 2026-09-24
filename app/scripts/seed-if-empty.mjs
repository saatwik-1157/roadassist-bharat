#!/usr/bin/env node
/**
 * Seed, but only into an empty database.
 *
 * `npm run seed` is deliberately not idempotent: it inserts the roles the
 * migration already created and dies on a unique violation. That is fine for a
 * developer who resets first, and wrong for a stack you bring up with one
 * command — the second `docker compose up` would fail on a database that is
 * perfectly healthy, which reads as a broken stack rather than as "already
 * done".
 *
 * So: look first, and say which of the two happened.
 *
 *   node scripts/seed-if-empty.mjs
 *
 * Exits 0 whether it seeded or skipped. It exits non-zero only when the seed
 * itself failed, which is the one case a compose dependency should stop for.
 */
import { spawnSync } from "node:child_process";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is unset — refusing to guess where the database is.");
  process.exit(1);
}

// Neon's copied string ends in channel_binding=require, which postgres.js sends
// to the server as a setting and the server refuses. The seeders go through
// checkDatabaseUrl() in packages/db, which drops it; this probe has to as well.
const probeUrl = (() => {
  try { const u = new URL(url.trim()); u.searchParams.delete("channel_binding"); return u.toString(); }
  catch { return url; }
})();
const sql = postgres(probeUrl, { max: 1, onnotice: () => {} });

let seeded = false;
try {
  // `users` rather than a role or an extension: roles are created by the
  // migration, so their presence says nothing about whether the demo data is
  // here. A user row only exists if the seed ran.
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM users`;
  seeded = n > 0;
  console.log(seeded ? `→ ${n} users already present` : "→ database is empty");
} catch (e) {
  console.error("could not read the users table — has the migration run?");
  console.error(`  ${e.message}`);
  await sql.end();
  process.exit(1);
} finally {
  await sql.end();
}

if (seeded) {
  console.log("✓ skipping seed — the database already has demo data");
  process.exit(0);
}

for (const script of ["seed", "seed:raksha"]) {
  console.log(`→ npm run ${script}`);
  const r = spawnSync("npm", ["run", script, "-w", "@roadassist/db"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    console.error(`✗ ${script} failed`);
    process.exit(r.status ?? 1);
  }
}

console.log("✓ seeded");
