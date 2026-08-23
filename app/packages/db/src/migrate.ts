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
  ] as const) {
    await db.execute(sql`
      ALTER TABLE ${sql.identifier(table)}
        ALTER COLUMN ${sql.identifier(col)} TYPE geometry(Point, 4326)
        USING ST_SetSRID(${sql.identifier(col)}, 4326)`);
  }

  console.log("→ applying post-migration constraints and indexes");
  // Soft delete: every read path filters on deleted_at, so index the alive rows only.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS bookings_alive_status_idx
      ON bookings (status) WHERE deleted_at IS NULL`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS mechanics_alive_avail_idx
      ON mechanics (is_available) WHERE deleted_at IS NULL AND verified = true`);
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
  // Ratings must be 1..5 — a CHECK the ORM does not generate.
  await db.execute(sql`
    ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_rating_range`);
  await db.execute(sql`
    ALTER TABLE reviews ADD CONSTRAINT reviews_rating_range
      CHECK (rating BETWEEN 1 AND 5)`);
  // Money is never negative.
  await db.execute(sql`
    ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_total_nonneg`);
  await db.execute(sql`
    ALTER TABLE invoices ADD CONSTRAINT invoices_total_nonneg CHECK (total_paise >= 0)`);
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
