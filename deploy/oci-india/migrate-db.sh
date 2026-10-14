#!/usr/bin/env bash
# Copy the RoadAssist database from Neon (Singapore) into the PostgreSQL that
# runs on this OCI VM, re-apply the least-privilege grants, and prove the copy
# is complete with exact row counts. Read migrate-db.md first.
#
# Run ON THE VM, from the clone cloud-init made:
#
#   cd /opt/roadassist && sudo docker compose up -d db      # database only
#   read -rs SOURCE_DATABASE_URL && export SOURCE_DATABASE_URL   # paste, Enter
#   sudo -E /opt/roadassist/repo/deploy/oci-india/migrate-db.sh
#
# SOURCE_DATABASE_URL is the Neon OWNER's DIRECT string (no -pooler in the
# host). It is read from the environment, never from an argument, so it does
# not land in `ps` output or the shell history.
#
# The same script restores one of the VM's own nightly backups instead:
#
#   sudo SOURCE_DUMP=/opt/roadassist/backups/roadassist-....dump REPLACE_TARGET=1 \
#     /opt/roadassist/repo/deploy/oci-india/migrate-db.sh
#
# Options (environment):
#   REPLACE_TARGET=1  the VM's database already holds the schema (the first
#                     boot migrated it, or this is the cut-over re-run): drop
#                     and recreate it from the dump, in ONE transaction.
#                     Without it, a non-empty target is refused.
#   SOURCE_DUMP=path  restore this custom-format dump instead of dumping Neon.
#   KEEP_DUMP=1       keep the Neon dump. It holds personal data (phone
#                     numbers, positions), so by default it is deleted.
#   STACK_DIR=path    the compose directory (default /opt/roadassist).
#
# The client tools come from the database's own image (PostgreSQL 16), so the
# dump is made by a pg_dump matched to the target. A Neon project on a NEWER
# major than the target is refused: restoring into an older major is not
# supported.
#
# shellcheck disable=SC2016  # '$SRC' / '$TGT' are expanded INSIDE the client container, on purpose
set -euo pipefail

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

STACK_DIR="${STACK_DIR:-/opt/roadassist}"
REPLACE_TARGET="${REPLACE_TARGET:-0}"
KEEP_DUMP="${KEEP_DUMP:-0}"
SOURCE_DUMP="${SOURCE_DUMP:-}"
ROLE_SQL="$STACK_DIR/repo/app/packages/db/sql/least-privilege-role.sql"

command -v docker >/dev/null || die "docker is not installed (cloud-init installs it on the VM)."
[ -f "$STACK_DIR/compose.yml" ] || die "no $STACK_DIR/compose.yml - is this the VM cloud-init set up?"
[ -f "$STACK_DIR/.env" ] || die "no $STACK_DIR/.env yet (README step c)."
[ -f "$ROLE_SQL" ] || die "cannot find $ROLE_SQL (cloud-init clones the repository to $STACK_DIR/repo)."
if [ -n "$SOURCE_DUMP" ]; then
  [ -f "$SOURCE_DUMP" ] || die "SOURCE_DUMP=$SOURCE_DUMP does not exist."
  SRC=""
else
  [ -n "${SOURCE_DATABASE_URL:-}" ] \
    || die "SOURCE_DATABASE_URL is not set (the Neon owner's DIRECT string). Did you use sudo -E?"
  case "$SOURCE_DATABASE_URL" in
    *-pooler.*) die "that is Neon's POOLED string; pg_dump needs the direct one (no -pooler in the host).";;
  esac
  # TLS to Neon always: add sslmode=require when the string does not choose.
  case "$SOURCE_DATABASE_URL" in
    *sslmode=*) SRC="$SOURCE_DATABASE_URL" ;;
    *\?*)       SRC="$SOURCE_DATABASE_URL&sslmode=require" ;;
    *)          SRC="$SOURCE_DATABASE_URL?sslmode=require" ;;
  esac
fi

compose() { docker compose --project-directory "$STACK_DIR" -f "$STACK_DIR/compose.yml" "$@"; }

# A value from .env without sourcing it (compose's format is not shell).
env_value() { sed -n "s/^$1=//p" "$STACK_DIR/.env" | tail -n 1; }
DB_OWNER_PASSWORD="$(env_value DB_OWNER_PASSWORD)"
[ -n "$DB_OWNER_PASSWORD" ] || die "DB_OWNER_PASSWORD is empty in $STACK_DIR/.env."

# The VM's database, as its owner: roadassist_owner must own what is restored,
# so the default privileges it set at first start cover every table, and the
# migrations (which run as the owner) can still alter them.
TGT="postgres://roadassist_owner:${DB_OWNER_PASSWORD}@db:5432/roadassist"
export SRC TGT

IMAGE="$(compose config --images | grep -m1 postgis)" || die "cannot read the database image from compose.yml."
# compose.yml's project name is `roadassist`, so its internal network is:
DATA_NET="${COMPOSE_PROJECT_NAME:-roadassist}_data"
docker network inspect "$DATA_NET" >/dev/null 2>&1 \
  || die "no Docker network $DATA_NET: cd $STACK_DIR && sudo docker compose up -d db"

compose ps --status running --services | grep -qx db \
  || die "the database is not running: cd $STACK_DIR && sudo docker compose up -d db"
if compose ps --status running --services | grep -qx app; then
  die "the app is running and writing to the database. Stop it first: cd $STACK_DIR && sudo docker compose stop app"
fi

WORK="${WORK_DIR:-/root/roadassist-migration-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$WORK"
chmod 700 "$WORK"

# src|tgt CMD: run a client command in the database image. The source side is
# on the default bridge (it must reach Neon over the internet); the target side
# is on the internal `data` network (the only way to reach `db`). The URLs
# reach the container as environment variables, never as host arguments.
run_on() {
  local side="$1"; shift
  local net=bridge
  [ "$side" = tgt ] && net="$DATA_NET"
  docker run --rm -i --network "$net" -e SRC -e TGT -e PGCONNECT_TIMEOUT=20 \
    -v "$WORK:/work" --entrypoint sh "$IMAGE" -c "$*"
}
q() {  # q src|tgt SQL -> unaligned, tuples only
  local var='$SRC'
  [ "$1" = tgt ] && var='$TGT'
  printf '%s\n' "$2" | run_on "$1" "psql \"$var\" -X -q -At -v ON_ERROR_STOP=1"
}

APP_TABLES_SQL="SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e');"

# ── 1. look before touching anything ────────────────────────────────────────
say "Checking the databases"
TGT_NUM="$(q tgt 'SHOW server_version_num;')" || die "cannot connect to the VM's database as roadassist_owner."
TGT_MAJOR=$((TGT_NUM / 10000))
echo "target: this VM, PostgreSQL $TGT_MAJOR ($IMAGE)"
if [ -z "$SOURCE_DUMP" ]; then
  SRC_NUM="$(q src 'SHOW server_version_num;')" || die "cannot connect to SOURCE_DATABASE_URL."
  SRC_MAJOR=$((SRC_NUM / 10000))
  echo "source: Neon, PostgreSQL $SRC_MAJOR, $(q src 'SELECT pg_size_pretty(pg_database_size(current_database()));')"
  [ "$TGT_MAJOR" -ge "$SRC_MAJOR" ] \
    || die "Neon runs PostgreSQL $SRC_MAJOR, newer than the VM's $TGT_MAJOR. Change the image in compose.yml to a matching imresamu/postgis:$SRC_MAJOR-* tag before the database's first start (README)."
  SRC_TABLES="$(q src "$APP_TABLES_SQL")"
  [ "$SRC_TABLES" -gt 0 ] || die "the source has no application tables in public - wrong SOURCE_DATABASE_URL?"
  echo "application tables in the source: $SRC_TABLES"
else
  echo "source: the dump $SOURCE_DUMP"
fi
TGT_TABLES="$(q tgt "$APP_TABLES_SQL")"
echo "application tables in the target: $TGT_TABLES"
CLEAN_FLAGS=""
if [ "$TGT_TABLES" -gt 0 ]; then
  [ "$REPLACE_TARGET" = 1 ] \
    || die "the VM's database already has $TGT_TABLES tables. Re-run with REPLACE_TARGET=1 to replace them."
  CLEAN_FLAGS="--clean --if-exists"
  echo "REPLACE_TARGET=1: the VM's tables will be dropped and recreated in ONE transaction."
fi
# PostGIS and pgcrypto were created in public at first start, by the superuser.
[ "$(q tgt "SELECT count(*) FROM pg_extension WHERE extname = 'postgis';")" = 1 ] \
  || die "PostGIS is missing on the VM's database - did db-init/10-roadassist-roles.sh run?"

# ── 2. dump ─────────────────────────────────────────────────────────────────
if [ -z "$SOURCE_DUMP" ]; then
  say "Dumping Neon (custom format; Neon keeps serving while this runs)"
  # Only the application's two schemas: public (the tables) and drizzle (the
  # migration journal, so migrate.ts finds nothing left to apply). Schemas
  # that extensions bring with them (PostGIS's tiger/topology, if a source has
  # them) are the extension's business, not the app's.
  run_on src 'pg_dump --dbname="$SRC" --format=custom --schema=public --schema=drizzle --no-owner --no-privileges --file=/work/source.dump'
else
  say "Using $SOURCE_DUMP"
  cp "$SOURCE_DUMP" "$WORK/source.dump"
fi
chmod 600 "$WORK/source.dump"
ls -lh "$WORK/source.dump"

# Everything except: extensions and their comments (made at first start by the
# superuser; the owner may not create PostGIS), PostGIS's own spatial_ref_sys
# rows (the extension's table, owned by the superuser; the app uses only the
# standard SRID 4326, which every PostGIS install carries), the public schema
# itself (it exists), and objects only a superuser may create. Ownership and
# grants are dropped by --no-owner / --no-privileges: roadassist_owner owns
# everything, and roadassist_app's grants come from least-privilege-role.sql.
run_on tgt 'pg_restore --list /work/source.dump' \
  | grep -v -E '^[0-9]+; [0-9]+ [0-9]+ (EXTENSION|COMMENT - EXTENSION|EVENT TRIGGER|PUBLICATION|SUBSCRIPTION) ' \
  | grep -v -E '^[0-9]+; [0-9]+ [0-9]+ (SCHEMA - public|COMMENT - SCHEMA public)( |$)' \
  | grep -v -E '^[0-9]+; [0-9]+ [0-9]+ TABLE DATA public spatial_ref_sys ' \
  >"$WORK/restore.list"
echo "restore list: $(grep -c -v '^;' "$WORK/restore.list") entries"

# ── 3. restore, atomically ──────────────────────────────────────────────────
say "Restoring into the VM's database (one transaction: all of it or none of it)"
run_on tgt "pg_restore --dbname=\"\$TGT\" --use-list=/work/restore.list \
  --no-owner --no-privileges --no-publications --no-subscriptions \
  --no-security-labels --no-tablespaces --single-transaction --exit-on-error \
  $CLEAN_FLAGS /work/source.dump"

# ── 4. least privilege ──────────────────────────────────────────────────────
say "Re-applying app/packages/db/sql/least-privilege-role.sql as the owner"
cp "$ROLE_SQL" "$WORK/least-privilege-role.sql"
run_on tgt 'psql "$TGT" -X -q -v ON_ERROR_STOP=1 -f /work/least-privilege-role.sql'

# ── 5. prove it ─────────────────────────────────────────────────────────────
COUNT_SQL="SELECT format('%I.%I', n.nspname, c.relname) || ' ' ||
       (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r','p') AND n.nspname IN ('public', 'drizzle')
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
UNION ALL
SELECT 'rule ' || tablename || '.' || rulename FROM pg_rules WHERE schemaname = 'public'
 ORDER BY 1;"
q tgt "$COUNT_SQL" >"$WORK/target-counts.txt"
# The working copy goes (a SOURCE_DUMP original stays where it was).
if [ -n "$SOURCE_DUMP" ] || [ "$KEEP_DUMP" != 1 ]; then rm -f "$WORK/source.dump"; fi

if [ -n "$SOURCE_DUMP" ]; then
  say "Restored. Row counts now on the VM:"
  cat "$WORK/target-counts.txt"
  echo "Next: cd $STACK_DIR && sudo docker compose up -d"
  exit 0
fi

say "Comparing exact row counts (every application table) and the audit rules"
q src "$COUNT_SQL" >"$WORK/source-counts.txt"
if ! diff -u "$WORK/source-counts.txt" "$WORK/target-counts.txt"; then
  cat >&2 <<'EOF'

MISMATCH (diff above: - Neon, + this VM).
If Render was still running, the rows it wrote after the dump show up here,
which is expected for a REHEARSAL copy. For the CUT-OVER copy Render must be
suspended first, and then the counts must match exactly. Do not switch DNS
after a mismatch from a cut-over run.
EOF
  exit 2
fi
echo "MATCH: $(grep -vc '^rule ' "$WORK/target-counts.txt") tables, every row count identical. Audit rules:"
grep '^rule ' "$WORK/target-counts.txt" || echo "  (none - unexpected; migrate.ts re-creates them when the app starts)"

say "Done. Working files: $WORK"
echo "Next: cd $STACK_DIR && sudo docker compose up -d"
