#!/usr/bin/env bash
# `pnpm stack:restore-test`: proves a dump from bin/backup.sh restores. On the Mac, with a
# local directory standing in for R2 and the api image from `pnpm images:build`:
#
#   bin/restore-test.sh [<tag>]
#
# 1. A source stack (postgres only) is migrated and given a sentinel season row.
# 2. bin/backup.sh dumps it and "uploads" to state/backup/r2 through the backup container.
# 3. A second project starts a fresh, empty Postgres container; bin/restore.sh restores the
#    dump into it.
# 4. The migrator against the restored database must print "migrate: up to date", and the
#    sentinel row must be there.
# Both projects come down, volumes included, whether the test passes or fails.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
case ${1:-} in -*) echo "usage: bin/restore-test.sh [<tag>]" >&2; exit 2 ;; esac
tag=${1:-$("$here/bin/image-tag.sh")}
docker image inspect "arena-ranking-api:$tag" >/dev/null 2>&1 \
  || { echo "missing image arena-ranking-api:$tag: run pnpm images:build first" >&2; exit 1; }

scratch=$(mktemp -d)
stack="$scratch/stack"
source_project="arena-restore-source-$$"
fresh_project="arena-restore-fresh-$$"
in_project() { local project=$1; shift; (cd "$stack" && COMPOSE_PROJECT_NAME=$project "$@"); }
compose() { local project=$1; shift; in_project "$project" docker compose "$@"; }
cleanup() {
  status=$?
  for project in "$source_project" "$fresh_project"; do
    [[ -d $stack ]] && compose "$project" --profile ops down --volumes --remove-orphans --timeout 10 >/dev/null 2>&1
  done
  rm -rf "$scratch"
  exit "$status"
}
trap cleanup EXIT
step() { echo "--- $*"; }
psql_value() { compose "$1" exec -T postgres psql -U arena -d arena -tAc "$2"; }

cp -R "$here" "$stack"
umask 077
cat > "$stack/.env" <<ENV
IMAGE_TAG=$tag
APP_UID=$(id -u)
APP_GID=$(id -g)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
REDIS_PASSWORD=$(openssl rand -hex 16)
R2_BUCKET=unused
ENV
docker network inspect web >/dev/null 2>&1 || docker network create web
# The backup container sees state/backup as /backup; a directory there stands in for R2.
export STACK_COMPOSE="docker compose" RCLONE_REMOTE=/backup/r2

step "source database"
compose "$source_project" up -d --wait postgres
compose "$source_project" --profile ops run --rm -T migrate
sentinel="Restore test $$"
psql_value "$source_project" "insert into seasons (name, first_patch, starts_at) values ('$sentinel', '99.1', now())" >/dev/null

step "backup"
in_project "$source_project" bash bin/backup.sh
object=$(sed -E 's/^[^ ]+ ok ([^ ]+) .*/\1/' "$stack/state/backup.last")
[[ -f $stack/state/backup/r2/$object ]] || { echo "no $object in the stand-in remote" >&2; exit 1; }

step "restore into a fresh container"
compose "$fresh_project" up -d --wait postgres
[[ $(psql_value "$fresh_project" "select to_regclass('public.seasons') is null") == t ]] \
  || { echo "the fresh database is not empty" >&2; exit 1; }
in_project "$fresh_project" bash bin/restore.sh "$object"

step "migrator on the restored database"
migrated=$(compose "$fresh_project" --profile ops run --rm -T migrate)
echo "$migrated"
[[ $migrated == "migrate: up to date" ]] || { echo "the migrator found work pending" >&2; exit 1; }
[[ $(psql_value "$fresh_project" "select count(*) from seasons where name = '$sentinel'") == 1 ]] \
  || { echo "the sentinel row did not survive the restore" >&2; exit 1; }
echo "sentinel row restored"
echo "stack:restore-test ok"
