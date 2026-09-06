import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadDotEnv } from "./dotenv.js";
import * as identity from "./schema/identity.js";
import * as fleet from "./schema/fleet.js";
import * as service from "./schema/service.js";
import * as ops from "./schema/ops.js";
import * as raksha from "./schema/raksha.js";

export const schema = { ...identity, ...fleet, ...service, ...ops, ...raksha };

// Before DATABASE_URL is read, not after: the migrator and the seeders run with
// this workspace as their cwd, so without the upward search they would never
// see the .env the API is configured from.
loadDotEnv();

export const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://roadassist:devpassword@localhost:5434/roadassist";

/**
 * One pooled connection per process. `max` is deliberately small: in production
 * PgBouncer fronts the database and each pod holds only a handful of sessions.
 */
export function createClient(url: string = DATABASE_URL, max = 10) {
  const sql = postgres(url, { max, onnotice: () => {} });
  return { sql, db: drizzle(sql, { schema }) };
}

export type Database = ReturnType<typeof createClient>["db"];
