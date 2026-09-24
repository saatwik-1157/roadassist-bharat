/**
 * DATABASE_URL validation.
 *
 * Written after a deploy where only the password was pasted into DATABASE_URL:
 * the driver threw "Invalid URL" with the input attached, and the password
 * landed in the deploy logs. A malformed value must fail with a message that
 * explains the fix and never repeats the value.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { checkDatabaseUrl } from "../src/client.js";

const SECRET = "npg_notARealPassword123";

test("a bare password is rejected, and the message never contains it", () => {
  assert.throws(
    () => checkDatabaseUrl(SECRET),
    (err: Error) => {
      assert.match(err.message, /not a postgres connection string/);
      assert.ok(!err.message.includes(SECRET), "the value leaked into the error message");
      return true;
    },
  );
});

test("a URL of another scheme is rejected without echoing it", () => {
  const value = `mysql://user:${SECRET}@db.internal/app`;
  assert.throws(() => checkDatabaseUrl(value), (err: Error) => !err.message.includes(SECRET));
});

test("a postgres connection string is accepted, trimmed", () => {
  const url = "postgresql://owner:pw@ep-example.us-east-2.aws.neon.tech/neondb?sslmode=require";
  assert.equal(checkDatabaseUrl(`  ${url}\n`), url);
  assert.equal(checkDatabaseUrl("postgres://roadassist:demopassword@db:5432/roadassist"),
    "postgres://roadassist:demopassword@db:5432/roadassist");
});
