/**
 * The API's database role cannot change the schema.
 *
 * packages/db/sql/least-privilege-role.sql creates `roadassist_app`: DML on the
 * application tables, SELECT and INSERT only on audit_log, and nothing that
 * changes structure. These tests connect AS that role and try the things it
 * must never be able to do - drop or alter the audit log, drop its
 * append-only rules, create a table - and require each to be refused.
 *
 * They need a real database with the role set up, so they run only when
 * LEAST_PRIVILEGE_DB_URL is set to the app role's connection string, and skip
 * otherwise (CI has no such role):
 *
 *   LEAST_PRIVILEGE_DB_URL=postgres://roadassist_app:...@localhost:5434/<db> \
 *     node --import tsx --test packages/db/test/least-privilege.test.ts
 *
 * Every attempt runs inside a transaction that is always rolled back, so a
 * statement that wrongly succeeds is reported as a failure and undone, never
 * left behind.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";

const URL = process.env.LEAST_PRIVILEGE_DB_URL;
const skip = URL ? false : "LEAST_PRIVILEGE_DB_URL is not set";

const sql = URL ? postgres(URL, { max: 1, onnotice: () => {} }) : null;
after(async () => { await sql?.end({ timeout: 5 }); });

class Rollback extends Error {}

/** Runs `statement` and rolls back. Returns the error it raised, or null if it succeeded. */
async function attempt(statement: string): Promise<{ code?: string; message: string } | null> {
  try {
    await sql!.begin(async (tx) => {
      await tx.unsafe(statement);
      throw new Rollback();
    });
  } catch (e) {
    if (e instanceof Rollback) return null;
    return e as { code?: string; message: string };
  }
  return null;
}

async function refused(statement: string) {
  const err = await attempt(statement);
  assert.ok(err, `the app role was ALLOWED to run: ${statement}`);
  // 42501 insufficient_privilege: "must be owner of ..." / "permission denied for ...".
  assert.equal(err.code, "42501", `expected a privilege error for ${statement}, got ${err.code}: ${err.message}`);
}

test("it is connected as a plain role that owns nothing", { skip }, async () => {
  const [me] = await sql!`
    SELECT current_user AS name, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolbypassrls,
           (SELECT count(*)::int FROM pg_class c WHERE c.relowner = r.oid) AS owned,
           (SELECT count(*)::int FROM pg_auth_members m WHERE m.member = r.oid) AS memberships,
           (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_log') AS audit_owner
      FROM pg_roles r WHERE r.rolname = current_user`;
  assert.equal(me.rolsuper, false, "the app role is a superuser");
  assert.equal(me.rolcreatedb, false);
  assert.equal(me.rolcreaterole, false);
  assert.equal(me.rolbypassrls, false);
  assert.equal(me.owned, 0, "the app role owns relations");
  assert.equal(me.memberships, 0, "the app role inherits another role's privileges");
  assert.ok(me.audit_owner, "audit_log does not exist - migrate the database first");
  assert.notEqual(me.audit_owner, me.name, "the app role owns audit_log");
});

test("it can still do the API's work: read and write rows, append to the audit log", { skip }, async () => {
  const [p] = await sql!`
    SELECT has_table_privilege('public.users', 'SELECT')      AS users_select,
           has_table_privilege('public.users', 'INSERT')      AS users_insert,
           has_table_privilege('public.users', 'UPDATE')      AS users_update,
           has_table_privilege('public.users', 'DELETE')      AS users_delete,
           has_table_privilege('public.audit_log', 'SELECT')  AS audit_select,
           has_table_privilege('public.audit_log', 'INSERT')  AS audit_insert,
           has_table_privilege('public.audit_log', 'UPDATE')  AS audit_update,
           has_table_privilege('public.audit_log', 'DELETE')  AS audit_delete`;
  assert.deepEqual(
    { ...p },
    {
      users_select: true, users_insert: true, users_update: true, users_delete: true,
      audit_select: true, audit_insert: true, audit_update: false, audit_delete: false,
    },
  );
  // The audit chain verifier counts the append-only rules through pg_rules.
  const [{ rules }] = await sql!`
    SELECT count(*)::int AS rules FROM pg_rules
     WHERE tablename = 'audit_log' AND rulename IN ('audit_log_no_update', 'audit_log_no_delete')`;
  assert.equal(rules, 2, "the app role cannot see both append-only rules");
});

test("it cannot drop or alter the audit log", { skip }, async () => {
  await refused("DROP TABLE audit_log");
  await refused("ALTER TABLE audit_log ADD COLUMN tampered text");
  await refused("ALTER TABLE audit_log DISABLE RULE audit_log_no_update");
  await refused("ALTER TABLE audit_log OWNER TO CURRENT_USER");
});

test("it cannot drop or replace the append-only rules", { skip }, async () => {
  await refused("DROP RULE audit_log_no_update ON audit_log");
  await refused("DROP RULE audit_log_no_delete ON audit_log");
  await refused("CREATE OR REPLACE RULE audit_log_no_delete AS ON DELETE TO audit_log DO ALSO NOTHING");
});

test("it cannot rewrite or empty the audit log", { skip }, async () => {
  // UPDATE and DELETE are not refused with an error: the DO INSTEAD NOTHING
  // rules rewrite them into no query at all, and PostgreSQL checks privileges
  // on the rewritten query, so there is nothing left to deny. They must change
  // nothing. (The role also lacks UPDATE and DELETE on audit_log, which is
  // what would stop it if the rules were ever dropped.)
  let seen: { before: number; after: number; tampered: number } | null = null;
  try {
    await sql!.begin(async (tx) => {
      const [{ n: before }] = await tx`SELECT count(*)::int AS n FROM audit_log`;
      await tx`UPDATE audit_log SET action = 'tampered'`;
      const [{ n: tampered }] = await tx`SELECT count(*)::int AS n FROM audit_log WHERE action = 'tampered'`;
      await tx`DELETE FROM audit_log`;
      const [{ n: after }] = await tx`SELECT count(*)::int AS n FROM audit_log`;
      seen = { before, after, tampered };
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  assert.ok(seen, "the probe did not run");
  const { before, after, tampered } = seen as { before: number; after: number; tampered: number };
  assert.equal(tampered, 0, "an UPDATE changed audit entries");
  assert.equal(after, before, "a DELETE removed audit entries");
  // TRUNCATE is the one statement a rule cannot intercept, so it must be
  // refused by privilege.
  await refused("TRUNCATE audit_log");
});

test("it cannot create or drop anything", { skip }, async () => {
  await refused("CREATE TABLE least_privilege_probe (id int)");
  await refused("CREATE TEMP TABLE least_privilege_probe (id int)");
  await refused("CREATE SCHEMA least_privilege_probe");
  await refused("DROP TABLE users");
  await refused("ALTER TABLE users ADD COLUMN tampered text");
  await refused("CREATE INDEX least_privilege_probe_idx ON users (id)");
  await refused("TRUNCATE users");
});
