/**
 * When the database connection must be TLS.
 *
 * postgres.js connects in plain text unless told otherwise, so a managed
 * database reached with a URL that omitted sslmode carried credentials and
 * rows in the clear. These pin the rule — and, just as much, the places it must
 * NOT fire: local docker, CI's service container and container-network hosts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { requiredSsl } from "../src/client.js";

const REMOTE = "postgresql://owner:pw@ep-example.us-east-2.aws.neon.tech/neondb";
const NO_ENV = {};

test("a remote host with no sslmode is forced onto TLS outside development", () => {
  assert.equal(requiredSsl(REMOTE, "production", NO_ENV), "require");
  assert.equal(requiredSsl(REMOTE, "demo", NO_ENV), "require");
  assert.equal(requiredSsl("postgres://u:p@10.0.0.7:5432/db", "production", NO_ENV), "require");
});

test("development and test never change, whatever the host", () => {
  assert.equal(requiredSsl(REMOTE, "development", NO_ENV), undefined);
  assert.equal(requiredSsl(REMOTE, "test", NO_ENV), undefined);
});

test("an explicit sslmode in the URL is left to the driver", () => {
  assert.equal(requiredSsl(`${REMOTE}?sslmode=require`, "production", NO_ENV), undefined);
  assert.equal(requiredSsl(`${REMOTE}?sslmode=verify-full`, "production", NO_ENV), undefined);
  assert.equal(requiredSsl(`${REMOTE}?sslrootcert=system`, "production", NO_ENV), undefined);
});

test("PGSSL in the environment is respected, since postgres.js reads it", () => {
  assert.equal(requiredSsl(REMOTE, "production", { PGSSL: "verify-full" }), undefined);
});

test("loopback hosts are exempt: local docker on localhost:5434", () => {
  for (const host of ["localhost:5434", "127.0.0.1:5434", "[::1]:5434"]) {
    assert.equal(requiredSsl(`postgres://roadassist:demopassword@${host}/roadassist`, "production", NO_ENV),
      undefined, host);
  }
});

test("CI's service container (localhost:5432) is exempt", () => {
  assert.equal(
    requiredSsl("postgres://roadassist:devpassword@localhost:5432/roadassist_test", "ci", NO_ENV),
    undefined);
});

test("container-network service names are exempt (compose `db`, the image smoke test's `ra-db`)", () => {
  assert.equal(requiredSsl("postgres://roadassist:demopassword@db:5432/roadassist", "demo", NO_ENV), undefined);
  assert.equal(requiredSsl("postgres://roadassist:x@ra-db:5432/roadassist", "production", NO_ENV), undefined);
});
