#!/bin/sh
# First start of the VM's database ONLY (the postgres image runs
# /docker-entrypoint-initdb.d/* when the data volume is empty, never again).
# Written to /opt/roadassist/db-init/ by cloud-init.yaml, which embeds this file
# (after editing it, run node deploy/oci-india/build-cloud-init.mjs).
#
# Three roles, the same split as on Neon:
#   postgres          superuser. Backups and this script; the app never sees it.
#   roadassist_owner  owns the database and every table; migrations run as it
#                     (MIGRATION_DATABASE_URL), then docker-start.sh unsets it.
#                     CREATEROLE only so it can create and manage
#                     roadassist_app, exactly like neondb_owner on Neon.
#   roadassist_app    the API's role: rows, never schema
#                     (app/packages/db/sql/least-privilege-role.sql).
#
# Passwords come from /opt/roadassist/.env through compose.yml and are read
# with \getenv, so they never appear in a process list. Changing them in .env
# later does NOT change them here: see README, "Changing a database password".
set -eu
: "${DB_OWNER_PASSWORD:?DB_OWNER_PASSWORD is not set}"
: "${DB_APP_PASSWORD:?DB_APP_PASSWORD is not set}"

# As the superuser: the owner role, the database's ownership, and the two
# extensions migrate.ts asks for. PostGIS is not a trusted extension, so only
# a superuser may create it; migrate.ts's CREATE EXTENSION IF NOT EXISTS then
# finds it present and needs no such right.
psql -v ON_ERROR_STOP=1 -X -q --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv owner_pw DB_OWNER_PASSWORD
\getenv dbname POSTGRES_DB
CREATE ROLE roadassist_owner LOGIN CREATEROLE NOSUPERUSER NOCREATEDB PASSWORD :'owner_pw';
ALTER DATABASE :"dbname" OWNER TO roadassist_owner;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL

# As the OWNER (over the init server's unix socket): the repository's own
# least-privilege file creates roadassist_app and sets default privileges, so
# every table the owner creates from now on - the migrations at first boot, or
# migrate-db.sh's restore - is readable and writable by the app and nothing
# more. The db-grants service runs the same file again after each start, once
# the tables exist, which is what takes UPDATE/DELETE on audit_log away.
psql -v ON_ERROR_STOP=1 -X -q --username roadassist_owner --dbname "$POSTGRES_DB" \
  -f /roadassist-sql/least-privilege-role.sql >/dev/null
psql -v ON_ERROR_STOP=1 -X -q --username roadassist_owner --dbname "$POSTGRES_DB" <<'SQL'
\getenv app_pw DB_APP_PASSWORD
ALTER ROLE roadassist_app WITH PASSWORD :'app_pw';
SQL

echo "roadassist: roles roadassist_owner and roadassist_app created"
