#!/usr/bin/env bash
# Nightly dump of the carcheck database, kept for a while on the server and copied off it.
#
# Cron (as a user who can run pg_dump or docker), for example at 03:15:
#   15 3 * * * /opt/car-check/deploy/backup.sh >> /var/log/carcheck-backup.log 2>&1
#
# Settings, from the environment or from deploy/backup.env next to this script:
#   DATABASE_URL     postgres://carcheck:…@host:5432/carcheck (used when pg_dump is on the host)
#   PG_CONTAINER     name of the existing Postgres container; dumps with `docker exec` instead
#   PG_USER, PG_DB   role and database inside that container (default carcheck/carcheck)
#   BACKUP_DIR       where dumps are kept on the server (default /var/backups/carcheck)
#   KEEP_DAYS        local dumps older than this are deleted (default 14)
#   BACKUP_REMOTE    rsync destination off the box, such as user@host:backups/carcheck/
#                    Leave empty to keep local copies only (the script warns).
#
# Restore: gunzip -c carcheck-<stamp>.sql.gz | psql "$DATABASE_URL"
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
[[ -f "$here/backup.env" ]] && source "$here/backup.env"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/carcheck}"
KEEP_DAYS="${KEEP_DAYS:-14}"
PG_USER="${PG_USER:-carcheck}"
PG_DB="${PG_DB:-carcheck}"

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/carcheck-$stamp.sql.gz"
tmp="$out.partial"
trap 'rm -f "$tmp"' EXIT

if [[ -n "${PG_CONTAINER:-}" ]]; then
  docker exec "$PG_CONTAINER" pg_dump --no-owner --no-privileges -U "$PG_USER" "$PG_DB" | gzip -9 > "$tmp"
elif [[ -n "${DATABASE_URL:-}" ]]; then
  pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$tmp"
else
  echo "backup: set PG_CONTAINER or DATABASE_URL" >&2
  exit 1
fi

# A dump that is empty or cut short must not replace a good one.
if ! gzip -t "$tmp" || [[ "$(gzip -dc "$tmp" | head -c 1 | wc -c)" -eq 0 ]]; then
  echo "backup: dump failed or was empty" >&2
  exit 1
fi
mv "$tmp" "$out"
echo "backup: wrote $out ($(du -h "$out" | cut -f1))"

find "$BACKUP_DIR" -name 'carcheck-*.sql.gz' -mtime "+$KEEP_DAYS" -delete

if [[ -n "${BACKUP_REMOTE:-}" ]]; then
  rsync -a "$out" "$BACKUP_REMOTE"
  echo "backup: copied to $BACKUP_REMOTE"
else
  echo "backup: BACKUP_REMOTE is not set, so this dump exists only on the server" >&2
fi
