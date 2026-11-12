#!/usr/bin/env bash
# Replaces the arena database with one dump from R2. Runs on the box from ~/apps/arena-ranking,
# with postgres up; on a fresh box, `sudo docker compose up -d --wait postgres` first.
#
#   bin/restore.sh <object>        e.g. nightly/2026-10-11T0300Z.dump.gz
#
# Stops web, api and worker, downloads the object, drops and recreates the database and
# restores into it. It leaves the stack stopped: run migrate, then `up -d` (docs/deploy.md,
# "Restore"). Same overrides as bin/backup.sh: STACK_COMPOSE, RCLONE_REMOTE, APP_DIR.
set -uo pipefail

cd "${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}" || exit 1
object=${1:?usage: bin/restore.sh <object>}

read -r -a compose <<< "${STACK_COMPOSE:-sudo docker compose}"
env_get() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2-; }
remote="${RCLONE_REMOTE:-r2:$(env_get R2_BUCKET)}"
file=state/backup/restore.dump.gz

pg() { "${compose[@]}" exec -T postgres "$@"; }
trap 'rm -f "$file"' EXIT

mkdir -p state/backup
"${compose[@]}" stop web api worker || { echo "restore: could not stop web, api and worker" >&2; exit 1; }
"${compose[@]}" --profile ops run --rm -T backup copyto "$remote/$object" /backup/restore.dump.gz \
  || { echo "restore: download failed" >&2; exit 1; }
gzip -t "$file" || { echo "restore: $object is not a whole gzip file" >&2; exit 1; }
pg dropdb -U arena --if-exists --force arena || { echo "restore: dropdb failed" >&2; exit 1; }
pg createdb -U arena arena || { echo "restore: createdb failed" >&2; exit 1; }
gunzip -c "$file" | pg pg_restore -U arena -d arena --no-owner --no-acl --exit-on-error \
  || { echo "restore: pg_restore failed" >&2; exit 1; }
echo "restored $object into arena; next: migrate, then up -d"
