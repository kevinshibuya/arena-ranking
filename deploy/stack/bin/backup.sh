#!/usr/bin/env bash
# Dumps the arena database, uploads it to Cloudflare R2 through the one-shot rclone container,
# verifies the upload and keeps 30 nightly dumps. Runs on the box from ~/apps/arena-ranking:
# nightly from cron (backup.cron), and from bin/deploy.sh before every migration as
# `--prefix premigrate --name <tag>`.
#
#   bin/backup.sh [--prefix <prefix>] [--name <name>]
#
# The object is <prefix>/<name>.dump.gz; the name defaults to the UTC stamp <YYYY-MM-DD>T<HHMM>Z.
# Only the nightly prefix sweeps retention and writes state/backup.last. Any failure exits 1,
# and on nightly writes "<iso> fail <step>" to state/backup.last.
#
# Overrides, for bin/restore-test.sh: STACK_COMPOSE (replaces `sudo docker compose`),
# RCLONE_REMOTE (replaces r2:$R2_BUCKET, a path inside the backup container), APP_DIR.
set -uo pipefail

cd "${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}" || exit 1

prefix=nightly
name=$(date -u +%Y-%m-%dT%H%MZ)
while [[ $# -gt 0 ]]; do
  case $1 in
    --prefix) prefix=${2:?--prefix needs a value}; shift 2 ;;
    --name) name=${2:?--name needs a value}; shift 2 ;;
    *) echo "usage: bin/backup.sh [--prefix <prefix>] [--name <name>]" >&2; exit 2 ;;
  esac
done

read -r -a compose <<< "${STACK_COMPOSE:-sudo docker compose}"
env_get() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2-; }
iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
file="state/backup/$name.dump.gz"
object="$prefix/$name.dump.gz"

fail() {
  echo "backup failed at: $1" >&2
  rm -f "$file"
  [[ $prefix == nightly ]] && echo "$(iso) fail $1" > state/backup.last
  exit 1
}

mkdir -p state/backup || fail mkdir
remote="${RCLONE_REMOTE:-}"
if [[ -z $remote ]]; then
  bucket=$(env_get R2_BUCKET)
  [[ -n $bucket ]] || fail "config (no R2_BUCKET in .env)"
  remote="r2:$bucket"
fi

# -T: no TTY under cron, and a TTY would put \r into the lsl output.
rclone() { "${compose[@]}" --profile ops run --rm -T backup "$@"; }

"${compose[@]}" exec -T postgres pg_dump -U arena -d arena -Fc --no-owner --no-acl \
  | gzip -6 > "$file" || fail dump
[[ -s $file ]] || fail "dump (empty file)"
gzip -t "$file" || fail integrity
bytes=$(wc -c < "$file" | tr -d ' ')

rclone copyto "/backup/$name.dump.gz" "$remote/$object" || fail upload
listed=$(rclone lsl "$remote/$object" | awk 'NF { print $1; exit }')
[[ $listed == "$bytes" ]] || fail "verify (local $bytes, remote ${listed:-none})"
echo "uploaded $object $bytes bytes"

if [[ $prefix == nightly ]]; then
  rclone delete --min-age 31d "$remote/nightly" || fail retention
  echo "$(iso) ok $object $bytes" > state/backup.last
fi
rm -f "$file"
