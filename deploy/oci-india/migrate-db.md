# Moving the database from Neon (Singapore) to the OCI VM (India)

`migrate-db.sh` copies the live database from Neon into the PostgreSQL 16 +
PostGIS that runs **on the VM** (the `db` service in `compose.yml`), re-applies
the least-privilege grants, and proves the copy is complete. Neon is not
changed: it is only read.

Why the VM and not a Neon project in Mumbai: **Neon's free plan has no India
region.** Its region list is US East 1/2, US West 2, Singapore, Sydney,
Frankfurt, London and São Paulo; Mumbai (`aws-ap-south-1`) is not offered.

## What it does

1. **Looks first.** Connects to both, prints the PostgreSQL versions and the
   source size, and refuses to go on if: the source string is Neon's *pooled*
   one, the VM's database is older than Neon's (restoring into an older major
   is not supported), the VM's database already has tables and you did not
   say `REPLACE_TARGET=1`, PostGIS is missing on the VM, or **the app is
   running** (it would write during the copy).
2. **Dumps** schemas `public` (the tables) and `drizzle` (the migration
   journal) from Neon with `pg_dump --format=custom --no-owner
   --no-privileges`. The client is the VM database's own image (`pg_dump` 16),
   so the tool matches the target.
3. **Restores** with `pg_restore --no-owner --no-privileges
   --single-transaction --exit-on-error`, as `roadassist_owner`. All of it or
   none of it: a failure leaves the VM's database as it was. Skipped on
   purpose: `CREATE EXTENSION` lines (PostGIS and pgcrypto were created by the
   superuser at first start; the owner may not create PostGIS) and PostGIS's
   own `spatial_ref_sys` rows (the app only uses SRID 4326, which every PostGIS
   carries). With `REPLACE_TARGET=1` it adds `--clean --if-exists`, still in
   the same single transaction.
4. **Least privilege, as on Neon.** `--no-owner` makes `roadassist_owner` the
   owner of everything restored; Neon's own grants are not copied
   (`--no-privileges`). Then `app/packages/db/sql/least-privilege-role.sql`
   runs again as the owner: `roadassist_app` gets `SELECT/INSERT/UPDATE/DELETE`
   on the application tables, `audit_log` only `SELECT/INSERT`, and no
   `CREATE`, `TEMPORARY`, `TRUNCATE` or ownership. The table it prints at the
   end is that proof.
5. **Proves it.** Exact `count(*)` of every table in `public` and `drizzle` on
   both sides, plus the audit log's append-only rules, compared with `diff`.
   It exits non-zero on any difference.

The dump holds personal data (phone numbers, positions). It stays on the VM, in
a root-only folder, and is deleted after the check unless `KEEP_DUMP=1`.

## Downtime, and when to do it

Do it **twice**:

- **Rehearsal** (any time, Render stays live). Proves the copy works and gives
  the VM real data to test against (README step e). If Render writes during
  the dump, the counts can differ by those rows: that is expected here, and
  the script says so.
- **Cut-over** (README step f). Render is **suspended** first, so nothing
  writes to Neon; then the copy must match exactly. Expect about **10 to 20
  minutes** of downtime: suspend Render, copy (a few minutes for a database
  this size; the dump is small), start the app, switch DNS, wait for the
  certificate. Pick a quiet time: late night India time, for example 02:00
  to 04:00 IST, and not during a demo or review week.

## Run it

On the VM, after README steps b and c (`/opt/roadassist/.env` written):

```bash
cd /opt/roadassist
sudo docker compose up -d db                 # the database only
sudo docker compose stop app                 # if the app was started before

# The Neon OWNER's DIRECT string: Neon console -> your project -> Connect ->
# role neondb_owner, "Connection pooling" OFF -> copy. It has no "-pooler" in
# the host. Paste it at the prompt (nothing is echoed), then Enter.
read -rs SOURCE_DATABASE_URL && export SOURCE_DATABASE_URL

# Rehearsal, into an empty database:
sudo -E /opt/roadassist/repo/deploy/oci-india/migrate-db.sh

# If the database already has tables (the app was started and migrated it,
# or this is the cut-over), replace them with a fresh copy:
sudo -E REPLACE_TARGET=1 /opt/roadassist/repo/deploy/oci-india/migrate-db.sh

sudo docker compose up -d                     # everything
unset SOURCE_DATABASE_URL
```

The last lines of a good run:

```
==> Comparing exact row counts (every application table) and the audit rules
MATCH: 60 tables, every row count identical. Audit rules:
rule audit_log.audit_log_no_delete
rule audit_log.audit_log_no_update
```

The table count is the app's tables in `public` plus the migration journal
(`drizzle.__drizzle_migrations`): 59 with the image of 14 Oct 2026, one more
once a newer migration has shipped. Neon's own PostGIS rules
(`geometry_columns`) may appear in the list too.

## What was tested

On 14 Oct 2026, locally with Docker (amd64): a PostGIS 16 standing in for Neon,
migrated and seeded by the published image (58 application tables in
`public`, 25 users, 24 mechanics) and given `roadassist_app` exactly as on
Neon; then this script into the VM stack. First run: MATCH on 60 tables (those
58 plus `drizzle.__drizzle_migrations`, which the script also counts), app role `SELECT, INSERT`
on `audit_log` and DML elsewhere. A run while the app was up was refused. The
`REPLACE_TARGET=1` re-run: MATCH again, the app came back healthy
(`"database":"ok"`), the backup service wrote and verified a dump, and that
dump restored with `SOURCE_DUMP=... REPLACE_TARGET=1` brought back 102 rows
deliberately deleted after it was taken (tables owned by `roadassist_owner`,
app healthy again). As
`roadassist_app`: `CREATE TABLE`, `TRUNCATE`, `DROP TABLE audit_log` and a
temporary table were all refused. Two defects were found by that rehearsal and
fixed before this was written: `spatial_ref_sys` rows were refused (not the
owner's table), and PostGIS's `tiger` schema data was dumped and could not be
restored (hence `--schema=public --schema=drizzle`). It has NOT yet been run
against the real Neon project or on an arm64 VM.

## Going back

Rolling back to Render (README step h) needs no copy: Neon is untouched, and
Render resumes against it exactly as it was at the cut-over. The cost is that
anything written on the VM after the cut-over (sign-ins, bookings, reports) is
**not** in Neon. It stays on the VM and in its backups. Copying it back is not
scripted; for a demo, accepting that loss is usually the right call, and the
reason to roll back early rather than late.
