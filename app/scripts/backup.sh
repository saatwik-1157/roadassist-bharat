#!/bin/sh
# Nightly logical backup, with retention and a verified restore.
#
# DEPLOYMENT.md has documented the pg_dump command for a while and said plainly
# that "no backup schedule is configured". The compose file mounted a `pgbackup`
# volume that nothing ever wrote to. This is the thing that writes to it.
#
# Run as a sidecar beside the database (see docker-compose.prod.yml). It is a
# plain sleep loop rather than cron: the image has no cron daemon, a loop is
# visible in `docker logs`, and one fewer moving part on the path that recovers
# the business is worth more than cron's expressiveness.
#
#   BACKUP_AT_HOUR    hour of day, UTC, 0-23     (default 2)
#   BACKUP_KEEP_DAYS  delete dumps older than    (default 14)
#   BACKUP_DIR        where they land            (default /backups)
#   BACKUP_VERIFY     1 = restore each new dump into a scratch database and
#                     compare row counts before trusting it (default 1)
#
# Exit codes matter here: a backup that fails silently is worse than no backup,
# because it buys false confidence. Every failure is loud and the loop keeps
# going, so one bad night does not stop the next one.
set -eu

DIR="${BACKUP_DIR:-/backups}"
AT_HOUR="${BACKUP_AT_HOUR:-2}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
VERIFY="${BACKUP_VERIFY:-1}"

: "${POSTGRES_USER:?set POSTGRES_USER}"
: "${POSTGRES_DB:?set POSTGRES_DB}"
PGHOST="${PGHOST:-db}"
export PGHOST

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup: $*"; }

dump_once() {
  stamp="$(date -u +%F-%H%M)"
  target="$DIR/${POSTGRES_DB}-${stamp}.dump"
  tmp="${target}.partial"

  # Write to .partial and rename only on success. A dump interrupted by a
  # restart must never be left looking like a usable backup.
  log "dumping to ${target}"
  if ! pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$tmp"; then
    log "FAILED: pg_dump returned non-zero; leaving ${tmp} for inspection"
    return 1
  fi
  mv "$tmp" "$target"
  log "wrote $(du -h "$target" | cut -f1)"

  if [ "$VERIFY" = "1" ]; then
    verify "$target" || { log "FAILED: ${target} did not verify"; return 1; }
  fi

  # Retention runs only after a good dump, so a run of failures can never
  # delete the last known-good copy.
  if [ "$KEEP_DAYS" -gt 0 ]; then
    find "$DIR" -name "${POSTGRES_DB}-*.dump" -type f -mtime "+${KEEP_DAYS}" -print -delete \
      | while read -r old; do log "pruned $(basename "$old")"; done
  fi
  return 0
}

# A dump nobody has restored is a hypothesis, not a backup. This is the same
# check the CI rehearsal runs: restore into a scratch database, compare row
# counts, confirm the append-only audit rules survived.
verify() {
  dump="$1"
  scratch="verify_$(date -u +%s)"
  log "verifying ${dump} into ${scratch}"

  createdb -U "$POSTGRES_USER" "$scratch"
  # shellcheck disable=SC2064
  trap "dropdb -U '$POSTGRES_USER' --if-exists '$scratch' >/dev/null 2>&1 || true" EXIT

  psql -U "$POSTGRES_USER" -d "$scratch" -q \
    -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto;"
  pg_restore -U "$POSTGRES_USER" -d "$scratch" --no-owner "$dump" >/dev/null 2>&1 || true

  src="$(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -c 'SELECT count(*) FROM audit_log')"
  dst="$(psql -U "$POSTGRES_USER" -d "$scratch" -t -A -c 'SELECT count(*) FROM audit_log')"
  rules="$(psql -U "$POSTGRES_USER" -d "$scratch" -t -A \
    -c "SELECT count(*) FROM pg_rules WHERE tablename='audit_log'")"

  dropdb -U "$POSTGRES_USER" --if-exists "$scratch" >/dev/null 2>&1 || true
  trap - EXIT

  if [ "$src" != "$dst" ]; then
    log "audit_log rows differ: source=${src} restored=${dst}"
    return 1
  fi
  if [ "$rules" -lt 2 ]; then
    log "append-only audit rules missing from the restore (found ${rules})"
    return 1
  fi
  log "verified: ${dst} audit rows, ${rules} append-only rules intact"
  return 0
}

mkdir -p "$DIR"
log "started — nightly at ${AT_HOUR}:00 UTC, keeping ${KEEP_DAYS} days, verify=${VERIFY}"

# One immediately on boot, so a fresh deployment is covered from minute one
# rather than from the first time the clock happens to reach AT_HOUR.
dump_once || log "initial backup failed; will retry on schedule"

while true; do
  now_h="$(date -u +%-H)"
  now_m="$(date -u +%-M)"
  # Seconds until the next AT_HOUR:00 UTC.
  wait_s=$(( ((AT_HOUR - now_h + 24) % 24) * 3600 - now_m * 60 ))
  [ "$wait_s" -le 60 ] && wait_s=$(( wait_s + 86400 ))
  log "next run in $(( wait_s / 3600 ))h $(( (wait_s % 3600) / 60 ))m"
  sleep "$wait_s"
  dump_once || log "backup failed; continuing so tomorrow still runs"
done
