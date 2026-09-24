#!/usr/bin/env bash
#
# Dumps the Postgres database running in the aavishield-postgres container,
# compresses it, and uploads it to R2 via admin-api's own /internal/admin/
# backup-upload endpoint — not rclone directly: rclone's available apt
# package (1.53.3, from 2021, predates R2) came back "403 AccessDenied" on
# every upload attempted against this real bucket, while admin-api's own
# hand-rolled SigV4 client (already proven live for screenshots) uploads to
# the identical bucket/credentials with no issue. Going through admin-api
# reuses that proven path instead of chasing rclone's exact incompatibility.
#
# Needs BACKUP_UPLOAD_TOKEN set (in .env, passed to the admin-api container —
# see docker-compose.yml) and admin-api reachable at ADMIN_API_LOCAL_URL.
#
#   ./scripts/backup-db.sh
#
# Scheduled daily via cron, not anything checked into this repo (there's no
# in-repo scheduler) — `crontab -l` on the production host runs, as of this
# writing:
#   0 20 * * * cd /home/ubuntu/delsecure && ./scripts/backup-db.sh >> /home/ubuntu/delsecure/backup.log 2>&1
# (20:00 UTC = 01:30 IST, chosen as a quiet-hours slot for this deployment.)
# Written here so the schedule is discoverable from the code, not only from
# a crontab that would otherwise be tribal knowledge tied to one server —
# if this ever moves host, re-add the line above with `crontab -e`.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"

# Not `source`d: .env values (an SMTP password, real-world secrets in
# general) can contain characters like `$` or `<`/`>` that are perfectly
# valid as literal data but get shell-interpreted the moment a line is
# executed rather than just read — sourcing this file broke on exactly
# that the first time this ran against production's real .env. Pulling
# only the handful of keys this script actually needs, as plain text
# after the first `=`, never executes a single line of the file.
env_var() {
    [[ -f "$ENV_FILE" ]] || return 0
    grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2-
}
: "${BACKUP_UPLOAD_TOKEN:=$(env_var BACKUP_UPLOAD_TOKEN)}"
: "${BACKUP_UPLOAD_TOKEN:?BACKUP_UPLOAD_TOKEN not set — check .env}"

ADMIN_API_LOCAL_URL="${ADMIN_API_LOCAL_URL:-http://127.0.0.1:7100}"
CONTAINER="${POSTGRES_CONTAINER:-aavishield-postgres}"

DB_NAME="$(docker exec "$CONTAINER" printenv POSTGRES_DB)"
DB_USER="$(docker exec "$CONTAINER" printenv POSTGRES_USER)"
DB_PASSWORD="$(docker exec "$CONTAINER" printenv POSTGRES_PASSWORD)"
# This deployment runs Postgres on a non-default port inside its own
# container (docker-compose.yml maps 6432, not 5432) — pg_dump's default
# unix-socket connection assumes 5432, so it must be told explicitly. -h
# 127.0.0.1 makes this a TCP connection rather than the socket, which
# needs the password even though it's the same container talking to
# itself, so PGPASSWORD travels with the exec rather than relying on
# trust auth that only covers the socket.
DB_PORT="${POSTGRES_PORT:-6432}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
STAMP="$(date -u +%Y%m%d-%H%M%S)"
FILENAME="aavishield-db-$STAMP.sql.gz"
DUMP_FILE="$TMP/$FILENAME"

echo "==> Dumping $DB_NAME from $CONTAINER"
docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER" \
    pg_dump -h 127.0.0.1 -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges \
    | gzip -9 > "$DUMP_FILE"

SIZE="$(du -h "$DUMP_FILE" | cut -f1)"
echo "==> Uploading ($SIZE) to R2 via admin-api"
RESPONSE="$(curl -fsSL -X POST "$ADMIN_API_LOCAL_URL/internal/admin/backup-upload" \
    -H "Authorization: Bearer $BACKUP_UPLOAD_TOKEN" \
    -F "file=@$DUMP_FILE;filename=$FILENAME")"
echo "$RESPONSE"

echo "Done: $FILENAME"
