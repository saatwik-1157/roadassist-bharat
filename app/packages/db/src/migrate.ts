/**
 * Applies migrations, then the extensions and constraints drizzle-kit cannot express.
 * Safe to run repeatedly.
 */
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { createClient } from "./client.js";

const { sql: raw, db } = createClient();

async function main() {
  console.log("→ enabling extensions");
  await raw`CREATE EXTENSION IF NOT EXISTS postgis`;
  await raw`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  await raw`CREATE EXTENSION IF NOT EXISTS pg_stat_statements`.catch(() => {
    console.log("  (pg_stat_statements needs shared_preload_libraries — skipped)");
  });

  console.log("→ applying migrations");
  await migrate(db, { migrationsFolder: "./drizzle" });

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

  const [{ count }] = await db.execute<{ count: string }>(sql`
    SELECT count(*)::text AS count FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
  console.log(`✓ migrations complete — ${count} tables in public schema`);
}

main()
  .catch((e) => { console.error("✗ migration failed:", e); process.exitCode = 1; })
  .finally(() => raw.end());
