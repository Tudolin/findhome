#!/usr/bin/env bash
#
# FindHome — database backup.
#
#   ./deploy/backup.sh                 # writes ./backups/findhome-YYYYmmdd-HHMMSS.sql.gz
#   ./deploy/backup.sh /mnt/nas/backup # or anywhere else
#
# Nightly at 03:15 via the host crontab:
#   15 3 * * * cd /srv/findhome && ./deploy/backup.sh >> /var/log/findhome-backup.log 2>&1
#
# Restore:
#   gunzip -c backups/findhome-20260804-031500.sql.gz \
#     | docker compose exec -T db psql -U findhome -d findhome

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Read individual keys rather than sourcing: .env holds values with spaces
# (SCRAPE_CRON, SCRAPE_DEFAULT_CITY) that `. ./.env` would try to execute.
env_get() {
  [ -f .env ] || return 0
  sed -n "s/^$1=//p" .env | tail -n1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

POSTGRES_USER="$(env_get POSTGRES_USER)"; POSTGRES_USER="${POSTGRES_USER:-findhome}"
POSTGRES_DB="$(env_get POSTGRES_DB)";     POSTGRES_DB="${POSTGRES_DB:-findhome}"
KEEP_DAYS="$(env_get BACKUP_KEEP_DAYS)";  KEEP_DAYS="${KEEP_DAYS:-14}"

DEST="${1:-$ROOT/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$DEST/findhome-$STAMP.sql.gz"

mkdir -p "$DEST"

echo "[backup] dumping to $FILE"
# errexit is suspended so a failed dump is reported here and the stub file is
# cleaned up, instead of the script dying and leaving it behind.
set +e
docker compose exec -T db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  | gzip -9 > "$FILE"
STATUS=${PIPESTATUS[0]}
set -e

SIZE="$(stat -c%s "$FILE" 2>/dev/null || echo 0)"
if [ "$STATUS" -ne 0 ] || [ "$SIZE" -lt 1024 ]; then
  echo "[backup] FAILED: pg_dump exited ${STATUS}, wrote ${SIZE} bytes" >&2
  rm -f "$FILE"
  exit 1
fi

echo "[backup] ok — $(du -h "$FILE" | cut -f1)"

echo "[backup] pruning dumps older than ${KEEP_DAYS} days"
find "$DEST" -name 'findhome-*.sql.gz' -type f -mtime "+$KEEP_DAYS" -print -delete
