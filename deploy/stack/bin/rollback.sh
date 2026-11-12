#!/usr/bin/env bash
# Returns web, api and worker to PREVIOUS_IMAGE_TAG. Runs ON the box, from ~/apps/arena-ranking.
# Swaps IMAGE_TAG and PREVIOUS_IMAGE_TAG in .env, so a second rollback goes forward again.
# Never touches the database: migrations are forward-only.
set -uo pipefail

cd "${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}" || exit 1
read -r -a compose <<< "${STACK_COMPOSE:-sudo docker compose}"
wait_s="${DEPLOY_WAIT_S:-90}"
env_get() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2-; }
current=$(env_get IMAGE_TAG)
previous=$(env_get PREVIOUS_IMAGE_TAG)
[[ -n $previous ]] || { echo "rollback refused: PREVIOUS_IMAGE_TAG is empty"; exit 1; }

umask 077
if ! awk -v tag="$previous" -v prev="$current" '
  /^IMAGE_TAG=/ { print "IMAGE_TAG=" tag; next }
  /^PREVIOUS_IMAGE_TAG=/ { print "PREVIOUS_IMAGE_TAG=" prev; next }
  { print }
' .env > .env.next || ! mv .env.next .env; then
  rm -f .env.next
  echo "rollback failed writing .env"
  exit 1
fi

"${compose[@]}" up -d web api worker || { echo "rollback: up failed"; exit 1; }
healthy=0
for _ in $(seq 1 $(( wait_s / 5 ))); do
  status=$("${compose[@]}" ps --format '{{.Service}} {{.Health}}' web api worker)
  if [[ $(grep -c ' healthy$' <<< "$status") -eq 3 ]]; then healthy=1; break; fi
  sleep "${DEPLOY_POLL_S:-5}"
done
"${compose[@]}" ps
echo "rolled back to $previous (was $current)"
echo "Migrations are forward-only: the schema stays at $current's. To go back, restore"
echo "premigrate/$current.dump.gz with bin/restore.sh (docs/deploy.md, \"Rollback\")."
[[ $healthy -eq 1 ]] || { echo "rollback: web, api and worker not all healthy after ${wait_s} s"; exit 1; }
