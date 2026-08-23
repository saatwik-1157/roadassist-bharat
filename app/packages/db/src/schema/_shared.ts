/**
 * Conventions every table in RoadAssist follows.
 *
 * Universal columns (see docs/02-backend-lead-roadmap.md §Phase 3):
 *   id          uuid primary key
 *   created_at  timestamptz
 *   updated_at  timestamptz
 *   deleted_at  timestamptz NULL   -- soft delete; every read filters on this
 *   version     int                -- optimistic concurrency
 */
import { geometry, integer, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * PostGIS point, WGS-84.
 *
 * Uses drizzle's built-in `geometry` rather than a customType: a customType
 * whose dataType() contains parentheses is emitted by drizzle-kit as a *quoted
 * identifier* — `"geography(Point, 4326)"` — which Postgres reads as a type
 * literally named that, and the migration fails on the first table.
 *
 * Stored as geometry(point,4326) and cast to ::geography in distance queries,
 * so ST_DWithin still does true metres-on-a-sphere maths.
 */
export const geoPoint = (name: string) =>
  geometry(name, { type: "point", mode: "xy", srid: 4326 });

/** Spread into every table definition. */
export const base = {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
};

/** Only alive rows. Import and use in every read query. */
export const alive = sql`deleted_at IS NULL`;
