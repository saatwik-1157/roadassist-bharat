/** Drops and recreates the public schema. Development only — refuses on non-local hosts. */
import { createClient, DATABASE_URL } from "./client.js";

if (!/localhost|127\.0\.0\.1|host\.docker\.internal/.test(DATABASE_URL)) {
  console.error("✗ refusing to reset a non-local database:", DATABASE_URL.replace(/:[^:@]+@/, ":***@"));
  process.exit(1);
}

const { sql } = createClient();

await sql`DROP SCHEMA IF EXISTS public CASCADE`;
await sql`CREATE SCHEMA public`;
// The migration journal lives in its own schema. Dropping only `public` leaves
// drizzle believing every migration is still applied, so the next `migrate`
// silently creates nothing and the post-migration statements fail on missing tables.
await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
await sql.end();
console.log("✓ schema and migration journal reset — run `npm run db:migrate` next");
