#!/usr/bin/env sh
# Nightly backup of the Pointbreak SQLite database.
#
#   sh scripts/backup.sh                 # -> /var/backups/pointbreak/app-YYYY-MM-DD.db
#   BACKUP_DIR=/mnt/usb sh scripts/backup.sh
#   BACKUP_KEEP_DAYS=30 sh scripts/backup.sh
#
# Install it as a daily cron job (DEPLOY-FREE.md section 4). Safe to run by hand
# at any time; it never stops the app.
#
# The database is a single file that the API rewrites on every change, so the
# copy is taken *inside* the container first and only then pulled out. Writes
# are atomic (`<db>.tmp` + rename), so the in-container copy is either the old
# or the new file, never a half-written one.

set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

SERVICE=${SERVICE:-pointbreak-api}
DEST=${BACKUP_DIR:-/var/backups/pointbreak}
KEEP_DAYS=${BACKUP_KEEP_DAYS:-14}
DB=${DB_FILE:-/app/data/pointbreak-rides-fiji.db}

log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }
die() { log "ERROR: $*"; exit 1; }

cid=$(docker compose ps -q "$SERVICE" 2>/dev/null || true)
[ -n "$cid" ] || die "service $SERVICE is not running (docker compose ps -q $SERVICE is empty)"

mkdir -p "$DEST" || die "cannot create $DEST"
OUT="$DEST/app-$(date +%F).db"

# 1. Copy the file to /tmp inside the container (same filesystem view as the app).
docker compose exec -T "$SERVICE" sh -c "cp '$DB' /tmp/pointbreak-backup.db" \
  || die "could not copy $DB inside $SERVICE"

# 2. Pull it out, verify, then rename so a partial/corrupt copy is never promoted.
docker cp "$cid:/tmp/pointbreak-backup.db" "$OUT.part" || die "docker cp failed"
head -c 16 "$OUT.part" 2>/dev/null | grep -q 'SQLite format 3' \
  || { rm -f "$OUT.part"; die "the copied database is not valid SQLite — backup not written"; }
mv "$OUT.part" "$OUT" || die "cannot write $OUT"

docker compose exec -T "$SERVICE" sh -c 'rm -f /tmp/pointbreak-backup.db' || true

log "backup ok: $OUT ($(du -h "$OUT" 2>/dev/null | cut -f1))"

find "$DEST" -name 'app-*.db' ! -name 'app-pre-restore.db' -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
log "kept the last ${KEEP_DAYS} days in $DEST"
