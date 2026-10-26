#!/usr/bin/env sh
# Restore a Pointbreak database from a backup made by scripts/backup.sh.
#
#   sh scripts/restore.sh /var/backups/pointbreak/app-2026-10-26.db
#   FORCE=1 sh scripts/restore.sh ...          # skip the pre-restore safety copy
#
# The API is stopped for the duration (a few seconds). The database that is
# live right now is copied aside first — to $BACKUP_DIR if that is writable,
# otherwise to $HOME — so a restore of the wrong day can be undone the same way.

set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

SERVICE=${SERVICE:-pointbreak-api}
DEST=${BACKUP_DIR:-/var/backups/pointbreak}
DB=${DB_FILE:-/app/data/pointbreak-rides-fiji.db}
FORCE=${FORCE:-0}

log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }
die() { log "ERROR: $*"; exit 1; }

[ $# -eq 1 ] || { echo "usage: $0 /var/backups/pointbreak/app-YYYY-MM-DD.db" >&2; exit 2; }
SRC=$1
[ -f "$SRC" ] || die "$SRC does not exist"
head -c 16 "$SRC" 2>/dev/null | grep -q 'SQLite format 3' || die "$SRC is not a SQLite database"
# Page 1 holds the schema, but a larger schema can spill; scan the file.
tr -d '\000' < "$SRC" | grep -q 'CREATE TABLE users' \
  || die "$SRC does not look like a Pointbreak database (no users table in the schema)"

cid=$(docker compose ps -a -q "$SERVICE" 2>/dev/null || true)
[ -n "$cid" ] || die "no container for $SERVICE — start the stack once first"

# Is there anything to lose? A stopped container cannot be `exec`-ed — and a
# stopped service is exactly when people restore — so ask a throwaway container
# on the same volume instead. One-offs get a generated name, so the
# `container_name:` in docker-compose.yml does not clash, and `run` drops
# published ports, so nothing tries to bind 3003 twice.
had_db=0
docker compose run --rm --no-deps --entrypoint sh "$SERVICE" \
  -c "test -f '$DB'" >/dev/null 2>&1 && had_db=1

# /var/backups is root-owned on a normal box, so never rely on it blindly.
if [ -d "$DEST" ] && [ -w "$DEST" ]; then
  SAFETY="$DEST/app-pre-restore.db"
elif [ ! -e "$DEST" ] && mkdir -p "$DEST" 2>/dev/null && [ -w "$DEST" ]; then
  SAFETY="$DEST/app-pre-restore.db"
else
  SAFETY="${HOME:-/tmp}/pointbreak-pre-restore.db"
  log "note: $DEST is not writable — keeping the current database at $SAFETY"
fi

# 1. Stop the API: it holds the database in memory and would overwrite the
#    restored file on the next write.
docker compose stop "$SERVICE" || die "could not stop $SERVICE"

# 2. Keep whatever is there now, before overwriting it.
if [ "$had_db" -eq 1 ]; then
  if docker cp "$cid:$DB" "$SAFETY"; then
    log "current database saved to $SAFETY"
  elif [ "$FORCE" = 1 ]; then
    log "WARN: could not save the current database (FORCE=1)"
  else
    # Nothing has been touched yet, so put the app back before bailing out.
    docker compose start "$SERVICE" >/dev/null 2>&1 || true
    die "could not save the current database — nothing was changed; set BACKUP_DIR to a writable directory, or re-run with FORCE=1"
  fi
else
  log "no database in the container yet — nothing to save"
fi

# 3. Copy the backup in. docker cp writes as root, but the app runs as `node`,
#    so ownership is fixed in a throwaway container on the same volume.
docker cp "$SRC" "$cid:$DB" || die "could not copy $SRC into the container"
docker compose run --rm --no-deps -u root --entrypoint sh "$SERVICE" \
  -c "chown node:node '$DB' && rm -f '$DB.tmp'" \
  || die "could not fix ownership of $DB"

# 4. Back online.
docker compose start "$SERVICE" || die "could not start $SERVICE"

log "restored $SRC"
sleep 3
docker compose exec -T "$SERVICE" wget -qO- http://localhost:3003/api/health \
  || log "WARN: /api/health did not answer yet — check: docker compose logs --tail 40 $SERVICE"
