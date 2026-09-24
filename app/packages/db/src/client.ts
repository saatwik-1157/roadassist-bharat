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

/**
 * The local development database, and ONLY that.
 *
 * This used to be an unconditional fallback, which meant a deployment with no
 * DATABASE_URL quietly tried to reach localhost:5434 and died with
 * ECONNREFUSED 127.0.0.1:5434 — a message that describes the symptom and hides
 * the cause. It cost a real deploy: the container looked like a networking
 * problem when the actual fault was one unset variable.
 *
 * env.ts refuses this fallback in production, but a demo or staging deployment
 * is not NODE_ENV=production and was never covered. Anything that is not
 * explicitly development or test now has to say where its database is.
 */
const DEV_DATABASE_URL = "postgres://roadassist:devpassword@localhost:5434/roadassist";

/**
 * A DATABASE_URL that is not a postgres URL fails fast here, and the message
 * never repeats the value. Handed straight to the driver, a malformed value -
 * a bare password pasted where the whole connection string belonged - made it
 * throw "Invalid URL" with the input attached, which printed the password into
 * the deploy logs.
 */
export function checkDatabaseUrl(value: string): string {
  const trimmed = value.trim();
  let parsed: URL | null = null;
  try {
    parsed = new URL(trimmed);
  } catch {
    parsed = null;
  }
  if (!parsed || (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") || !parsed.hostname) {
    throw new Error(
      "DATABASE_URL is not a postgres connection string. It must look like " +
      "postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require - the whole line, not " +
      "only the password. (The value is not shown here, because it may contain one.)",
    );
  }
  return trimmed;
}

function resolveDatabaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv) return checkDatabaseUrl(fromEnv);

  const mode = process.env.NODE_ENV ?? "development";
  if (mode === "development" || mode === "test") return DEV_DATABASE_URL;

  throw new Error(
    `DATABASE_URL is unset and NODE_ENV is "${mode}", so there is no database to use. ` +
    "The development default (localhost:5434) is deliberately not used outside " +
    "development and test, because falling back to it turns a missing variable into " +
    "a connection error against an address that was never going to answer.",
  );
}

export const DATABASE_URL = resolveDatabaseUrl();

/**
 * One pooled connection per process. `max` is deliberately small: in production
 * PgBouncer fronts the database and each pod holds only a handful of sessions.
 */
export function createClient(url: string = DATABASE_URL, max = 10) {
  const sql = postgres(url, { max, onnotice: () => {} });
  return { sql, db: drizzle(sql, { schema }) };
}

export type Database = ReturnType<typeof createClient>["db"];
