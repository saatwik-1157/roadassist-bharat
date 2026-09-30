-- ════════════════════════════════════════════════════════════════════════════
-- RoadAssist: the least-privilege role the running API connects as.
--
-- Run ONCE, by the database owner (on Neon: the SQL editor, as the role that
-- owns the tables and runs migrations, e.g. neondb_owner). Safe to run again:
-- every statement converges on the same state, so a rerun after a new
-- migration simply re-applies the grants.
--
-- It creates `roadassist_app` WITHOUT a password. Nothing secret lives in this
-- file or anywhere in the repository. The owner sets the password afterwards,
-- by hand (DEPLOYMENT.md, "Least-privilege database role"):
--
--     ALTER ROLE roadassist_app WITH PASSWORD '<generate a long random one>';
--
-- or with Reset password on the role in the Neon console, which shows the
-- generated value once. Do NOT create this role through the Neon console's
-- "New role" button: Neon adds console-created roles to neon_superuser, which
-- is exactly the power this role exists to take away. The check below refuses
-- a role that belongs to any other role for that reason.
--
-- ── what the API needs, and nothing more ────────────────────────────────────
--   CONNECT on this database, USAGE on schema public.
--   SELECT, INSERT, UPDATE, DELETE on the application tables. Every runtime
--     write is DML: ON CONFLICT DO UPDATE needs UPDATE, SELECT ... FOR UPDATE
--     needs UPDATE, and both are covered.
--   USAGE, SELECT on sequences. The schema has none today (ids are uuids from
--     gen_random_uuid()); granted so an identity column added later works.
--   audit_log: SELECT and INSERT only. The hash chain reads the previous
--     entry's hash and appends (apps/api/src/audit.ts); nothing at runtime
--     updates or deletes an entry, so those two privileges are revoked. Today
--     the append-only RULES (audit_log_no_update / _no_delete) turn an UPDATE
--     or DELETE into no query at all, before privileges are checked; the
--     revoke is what still stops the app if a rule is ever missing. Changing
--     or dropping a rule, or the table, needs OWNERSHIP, which this role never
--     has. TRUNCATE, which a rule cannot intercept, is never granted on any
--     table.
--   pg_advisory_xact_lock / pg_try_advisory_xact_lock (auth.ts, raksha demo
--     seed): no privilege at all. PostGIS and pgcrypto functions: EXECUTE,
--     which PUBLIC holds by default. pg_rules (audit chain verifier): a
--     catalog view readable by PUBLIC.
--
-- ── what it deliberately does NOT get ───────────────────────────────────────
--   CREATE on the schema or database (no tables, indexes, rules, schemas),
--   ownership of anything, TRUNCATE, REFERENCES, TRIGGER, and TEMPORARY on the
--   database (no runtime path creates a temp table). CREATE EXTENSION, the
--   ALTER TABLE ... TYPE geometry pins, the indexes and the audit RULES are
--   migrate.ts's work, and migrations keep running as the owner
--   (MIGRATION_DATABASE_URL in docker-start.sh). No access to the `drizzle`
--   schema, where the migration journal lives.
--
-- ── tables added later ──────────────────────────────────────────────────────
-- ALTER DEFAULT PRIVILEGES below makes every table the OWNER creates in public
-- from now on (any future migration, such as a photo store) readable and
-- writable by roadassist_app without rerunning this file. It applies to
-- objects created by the role that runs this script, so run it as the same
-- role MIGRATION_DATABASE_URL connects as. A new table that should be
-- append-only like audit_log needs its own REVOKE, as audit_log has here.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. The role. LOGIN, but no password yet, so it cannot sign in until the owner
--    sets one. No CREATEDB, no CREATEROLE. (An existing role's attributes are
--    checked in step 2 rather than reset here: PostgreSQL 16 lets only a role
--    that holds CREATEDB even say NOCREATEDB, so an ALTER would fail for an
--    owner without it.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roadassist_app') THEN
    CREATE ROLE roadassist_app LOGIN NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
ALTER ROLE roadassist_app LOGIN;

-- 2. Refuse a role that is more than a login: any elevated attribute, any
--    role membership (neon_superuser, pg_write_all_data ...) or any object it
--    owns would give back what the grants below withhold.
DO $$
DECLARE
  r pg_roles%ROWTYPE;
  member_of text;
  owns text;
BEGIN
  SELECT * INTO r FROM pg_roles WHERE rolname = 'roadassist_app';
  IF r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls THEN
    RAISE EXCEPTION 'roadassist_app has an elevated attribute (superuser, createdb, createrole, replication or bypassrls). Drop it and run this file again.';
  END IF;
  SELECT string_agg(g.rolname, ', ') INTO member_of
    FROM pg_auth_members m
    JOIN pg_roles g ON g.oid = m.roleid
   WHERE m.member = r.oid;
  IF member_of IS NOT NULL THEN
    RAISE EXCEPTION 'roadassist_app is a member of: %. A console-created role inherits neon_superuser; drop it (DROP ROLE roadassist_app) and let this file create it.', member_of;
  END IF;
  SELECT string_agg(c.oid::regclass::text, ', ') INTO owns
    FROM pg_class c WHERE c.relowner = r.oid;
  IF owns IS NOT NULL THEN
    RAISE EXCEPTION 'roadassist_app owns: %. The app role must own nothing; reassign ownership to the migration role first.', owns;
  END IF;
END
$$;

-- 3. Database: connect, nothing else. PUBLIC holds TEMPORARY on every database
--    by default and a role cannot be excluded from PUBLIC, so it is revoked
--    from PUBLIC here. The owner keeps it through its own ownership.
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM roadassist_app', current_database());
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO roadassist_app', current_database());
END
$$;

-- 4. Schema: use it, never create in it. PostgreSQL 15+ already withholds
--    CREATE from PUBLIC; revoking it again is harmless and covers a database
--    that was created or restored under older defaults.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM roadassist_app;
GRANT USAGE ON SCHEMA public TO roadassist_app;

-- 5. Tables. Start from nothing so a rerun removes anything granted by hand,
--    then grant DML on OUR tables: extension-owned tables such as PostGIS's
--    spatial_ref_sys stay read-only (PUBLIC can SELECT them already).
--    (Table by table rather than ON ALL TABLES: PostGIS's own views belong to
--    whoever installed the extension, and a blanket REVOKE warns about each.)
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM roadassist_app;
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      LEFT JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'e'
     WHERE c.relkind IN ('r', 'p', 'v') AND d.objid IS NULL
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM roadassist_app', t.relname);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO roadassist_app', t.relname);
  END LOOP;
END
$$;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO roadassist_app;

-- 6. The audit log is append-only for the application: read and append.
DO $$
BEGIN
  IF to_regclass('public.audit_log') IS NOT NULL THEN
    REVOKE UPDATE, DELETE ON public.audit_log FROM roadassist_app;
  END IF;
END
$$;

-- 7. Tables and sequences the owner creates from now on (future migrations).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO roadassist_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO roadassist_app;

-- 8. What was granted, for the person running this to read. Expect every
--    application table with SELECT, INSERT, UPDATE, DELETE except audit_log
--    (SELECT, INSERT), and create_in_schema / temp_in_database both false.
SELECT c.relname AS table_name,
       concat_ws(', ',
         CASE WHEN has_table_privilege('roadassist_app', c.oid, 'SELECT')   THEN 'SELECT' END,
         CASE WHEN has_table_privilege('roadassist_app', c.oid, 'INSERT')   THEN 'INSERT' END,
         CASE WHEN has_table_privilege('roadassist_app', c.oid, 'UPDATE')   THEN 'UPDATE' END,
         CASE WHEN has_table_privilege('roadassist_app', c.oid, 'DELETE')   THEN 'DELETE' END,
         CASE WHEN has_table_privilege('roadassist_app', c.oid, 'TRUNCATE') THEN 'TRUNCATE (unexpected)' END) AS privileges,
       has_schema_privilege('roadassist_app', 'public', 'CREATE')              AS create_in_schema,
       has_database_privilege('roadassist_app', current_database(), 'TEMP')   AS temp_in_database
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  LEFT JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'e'
 WHERE c.relkind IN ('r', 'p', 'v') AND d.objid IS NULL
 ORDER BY c.relname;
