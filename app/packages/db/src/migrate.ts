/**
 * Applies migrations, then the extensions and constraints drizzle-kit cannot express.
 * Safe to run repeatedly.
 */
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "./client.js";


/**
 * Find the migration folder from wherever this module happens to be.
 *
 * `migrationsFolder: "./drizzle"` resolved against the PROCESS working
 * directory, which is only correct when npm runs the script from
 * packages/db. The compiled image starts at /repo/app and the path resolved to
 * nothing, so a container could serve traffic but could never initialise its
 * own database - the failure only appears on a first deployment, against an
 * empty database, which is the worst moment to find it.
 *
 * server.ts already carries this lesson for its static roots: a path written
 * relative to src/ is wrong once the file is at dist/src/. Walking up for a
 * known directory is correct from either, and from a third if the layout moves.
 */
function migrationsFolder(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, "drizzle");
    if (existsSync(resolve(candidate, "meta/_journal.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "Cannot find the drizzle migration folder (no drizzle/meta/_journal.json above " +
    dirname(fileURLToPath(import.meta.url)) + "). A migration is two files plus a " +
    "journal entry; the journal is the one that is easy to leave behind.",
  );
}

const { sql: raw, db } = createClient();

async function main() {
  console.log("→ enabling extensions");
  await raw`CREATE EXTENSION IF NOT EXISTS postgis`;
  await raw`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  await raw`CREATE EXTENSION IF NOT EXISTS pg_stat_statements`.catch(() => {
    console.log("  (pg_stat_statements needs shared_preload_libraries — skipped)");
  });

  console.log("→ applying migrations");
  await migrate(db, { migrationsFolder: migrationsFolder() });

  console.log("→ pinning SRID on geospatial columns");
  // drizzle-kit emits `geometry(point)` without an SRID, which would let a row
  // in with any spatial reference and silently break distance maths. Tighten it.
  for (const [table, col] of [
    ["bookings", "location"],
    ["incidents", "location"],
    ["mechanics", "last_location"],
    ["responder_units", "last_location"],
    ["service_zones", "centre"],
    ["edge_devices", "location"],
    ["raksha_detections", "location"],
  ] as const) {
    await db.execute(sql`
      ALTER TABLE ${sql.identifier(table)}
        ALTER COLUMN ${sql.identifier(col)} TYPE geometry(Point, 4326)
        USING ST_SetSRID(${sql.identifier(col)}, 4326)`);
  }

  // road_segments.path is declared as bare `geometry` (drizzle-kit quotes a
  // parenthesised custom dataType) — pin it to a LineString here (ADR-0007).
  await db.execute(sql`
    ALTER TABLE road_segments
      ALTER COLUMN path TYPE geometry(LineString, 4326)
      USING ST_SetSRID(path, 4326)`);

  console.log("→ applying post-migration constraints and indexes");
  // Soft delete: every read path filters on deleted_at, so index the alive rows only.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS bookings_alive_status_idx
      ON bookings (status) WHERE deleted_at IS NULL`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS mechanics_alive_avail_idx
      ON mechanics (is_available) WHERE deleted_at IS NULL AND verified = true`);
  // ── indexes added from measured plans, not from habit ────────────────────
  // Both of these were confirmed Seq Scans (EXPLAIN, against the seeded
  // database) on queries that run on a hot path. Nothing is indexed here
  // because a column "looks like a key".
  //
  //   invoices(booking_id)    every payment begins by finding the invoice for a
  //                           booking, and it was a full scan of the table.
  //   payments(provider_ref)  the Razorpay webhook's ONLY lookup. Razorpay
  //                           retries until it gets a 2xx, so a slow webhook is
  //                           a self-amplifying load.
  //
  // Three other candidates were measured and deliberately NOT added:
  // dispatch_offers already has (mechanic_id, status), which is the selective
  // part of the inbox query; booking_events already has (booking_id,
  // created_at); and off-grid lookups by client reference are served by the
  // unique index from migration 0004. Adding a near-duplicate to each would
  // have cost write throughput on three hot tables and bought nothing.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS invoices_booking_alive_idx
      ON invoices (booking_id) WHERE deleted_at IS NULL`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS payments_provider_ref_idx
      ON payments (provider_ref)`);
  // An invoice settles AT MOST ONCE, and the database is the one that says so.
  //
  // The application already claims the booking before it records the money, so
  // two synchronous settlements cannot both win. That guard lives in one
  // handler. This one holds for every path into the table, including the
  // asynchronous one the guard does not cover: two callers can each create a
  // gateway order and a PENDING row before either settles, and without this
  // both confirmations would be accepted and the invoice would read as paid
  // twice. invoiceIsSettled only asks whether the settled sum COVERS the
  // total, so twice the money looks exactly like enough money.
  //
  // SETTLED only, deliberately. PENDING is a legitimate resting state — an
  // unverified confirmation leaves the row PENDING on purpose, because the
  // customer may still finish checkout — so including it here would let one
  // abandoned attempt block every retry on that invoice for good.
  //
  // This forbids instalments by construction. That is what the code already
  // does: the amount is never read from the request, it is the invoice total.
  // Splitting a payment would need this index reconsidered, not worked around.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS payments_invoice_settled_uq
      ON payments (invoice_id) WHERE status = 'SETTLED' AND deleted_at IS NULL`);
  // Retired: offers_inbox_idx duplicated offers_mechanic_idx's prefix.
  await db.execute(sql`DROP INDEX IF EXISTS offers_inbox_idx`);

  // Geospatial: GiST is what makes "nearest mechanic" fast.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS mechanics_location_gix
      ON mechanics USING GIST (last_location)`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS bookings_location_gix
      ON bookings USING GIST (location)`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS incidents_location_gix
      ON incidents USING GIST (location)`);
  // RAKSHA (ADR-0007): spatial indexes + range CHECKs the ORM cannot express.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS raksha_detections_location_gix
      ON raksha_detections USING GIST (location)`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS road_segments_path_gix
      ON road_segments USING GIST (path)`);
  // Each DROP+ADD pair travels as ONE multi-statement command (implicit
  // transaction), so a mid-run failure can never leave a range check missing.
  const checkPairs: Array<[string, string, string]> = [
    ["raksha_detections", "raksha_severity_range", "CHECK (severity BETWEEN 1 AND 5)"],
    ["raksha_detections", "raksha_confidence_range", "CHECK (confidence >= 0 AND confidence <= 1)"],
    // A GPS radius is a distance: never negative. NULL (not reported) stays
    // legal, which is what every row written before migration 0005 holds.
    ["raksha_detections", "raksha_location_accuracy_nonneg", "CHECK (location_accuracy_m IS NULL OR location_accuracy_m >= 0)"],
    ["road_health_scores", "road_health_score_range", "CHECK (score BETWEEN 0 AND 100)"],
    // Ratings must be 1..5 and money is never negative — CHECKs the ORM does not generate.
    ["reviews", "reviews_rating_range", "CHECK (rating BETWEEN 1 AND 5)"],
    ["invoices", "invoices_total_nonneg", "CHECK (total_paise >= 0)"],
  ];
  for (const [table, name, check] of checkPairs) {
    await raw.unsafe(
      `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name};
       ALTER TABLE ${table} ADD CONSTRAINT ${name} ${check};`,
    );
  }
  // The audit log is append-only from the application's point of view.
  await db.execute(sql`
    CREATE OR REPLACE RULE audit_log_no_update AS
      ON UPDATE TO audit_log DO INSTEAD NOTHING`);
  await db.execute(sql`
    CREATE OR REPLACE RULE audit_log_no_delete AS
      ON DELETE TO audit_log DO INSTEAD NOTHING`);

  // Count OUR tables, not everything that happens to live in `public`.
  //
  // `CREATE EXTENSION postgis` installs its own `spatial_ref_sys` table there,
  // so the obvious information_schema count returned 57 for a schema that
  // defines 56 — and that inflated number was quoted in six documents before
  // anyone asked which table was the odd one out. pg_depend knows the
  // difference: anything an extension owns has a 'e' dependency on it.
  // (Drizzle's own __drizzle_migrations never appeared here — it lives in the
  // `drizzle` schema, not this one.)
  const [{ count }] = await db.execute<{ count: string }>(sql`
    SELECT count(*)::text AS count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      LEFT JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'e'
     WHERE c.relkind = 'r' AND d.objid IS NULL`);
  console.log(`✓ migrations complete — ${count} application tables in public schema`);
}

main()
  .catch((e) => { console.error("✗ migration failed:", e); process.exitCode = 1; })
  .finally(() => raw.end());
