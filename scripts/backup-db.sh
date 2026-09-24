#!/usr/bin/env bash
#
# Dumps the Postgres database running in the aavishield-postgres container,
# compresses it, and uploads it to Cloudflare R2 — then prunes backups older
# than $RETENTION_DAYS from R2 so the bucket doesn't grow forever.
#
# Needs rclone on PATH (`apt-get install rclone` or https://rclone.org/install)
# and these in the environment (already in .env — this script sources it):
#   R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
# Configured via RCLONE_CONFIG_* env vars rather than an rclone.conf file, so
# there's nothing extra to keep in sync with .env or leave lying around with
# credentials in it.
#
# The bucket is shared with another application (see .env's own comment on
# R2_BUCKET_NAME) — every object this script writes lives under
# aavishield/db-backups/, matching SCREENSHOT_R2_PREFIX's reasoning for the
# same bucket.
#
#   ./scripts/backup-db.sh              # dump, upload, prune
#   ./scripts/backup-db.sh --list       # just list what's in R2
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
[[ -f "$ENV_FILE" ]] && set -a && source "$ENV_FILE" && set +a

: "${R2_ENDPOINT_URL:?R2_ENDPOINT_URL not set — check .env}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID not set — check .env}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY not set — check .env}"
: "${R2_BUCKET_NAME:?R2_BUCKET_NAME not set — check .env}"

export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT_URL"
export RCLONE_CONFIG_R2_REGION="${S3_REGION:-auto}"
export RCLONE_CONFIG_R2_ACL=private

REMOTE_DIR="R2:${R2_BUCKET_NAME}/aavishield/db-backups"
RETENTION_DAYS="${DB_BACKUP_RETENTION_DAYS:-30}"
CONTAINER="${POSTGRES_CONTAINER:-aavishield-postgres}"

if [[ "${1:-}" == "--list" ]]; then
    rclone lsl "$REMOTE_DIR"
    exit 0
fi

DB_NAME="$(docker exec "$CONTAINER" printenv POSTGRES_DB)"
DB_USER="$(docker exec "$CONTAINER" printenv POSTGRES_USER)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
STAMP="$(date -u +%Y%m%d-%H%M%S)"
DUMP_FILE="$TMP/aavishield-db-$STAMP.sql.gz"

echo "==> Dumping $DB_NAME from $CONTAINER"
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges \
    | gzip -9 > "$DUMP_FILE"

SIZE="$(du -h "$DUMP_FILE" | cut -f1)"
echo "==> Uploading ($SIZE) to $REMOTE_DIR/"
rclone copyto "$DUMP_FILE" "$REMOTE_DIR/aavishield-db-$STAMP.sql.gz"

echo "==> Pruning backups older than $RETENTION_DAYS days"
rclone delete --min-age "${RETENTION_DAYS}d" "$REMOTE_DIR"

echo "Done: aavishield-db-$STAMP.sql.gz"
