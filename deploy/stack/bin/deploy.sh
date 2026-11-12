#!/usr/bin/env bash
# Deploys one release on the box. Runs ON the box, from ~/apps/arena-ranking, after bin/ship.sh
# has loaded the images and copied these files. Builds nothing.
#
#   bin/deploy.sh <tag> [--first]
#
# In order: checks riot.key and .env; a premigrate dump to R2, premigrate/<tag>.dump.gz
# (skipped with --first, when there is no database yet); an .env.next with IMAGE_TAG=<tag>;
# migrate against it; .env.next becomes .env; up; wait for web, api and worker healthy; remove
# every arena-ranking image tag that is neither IMAGE_TAG nor PREVIOUS_IMAGE_TAG. Running it
# twice with the same tag keeps the rollback image. Never prunes: the build cache is shared.
set -uo pipefail

cd "${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}" || exit 1
new=${1:?usage: bin/deploy.sh <tag> [--first]}
first=0
[[ ${2:-} == --first ]] && first=1
read -r -a compose <<< "${STACK_COMPOSE:-sudo docker compose}"
wait_s="${DEPLOY_WAIT_S:-90}"

env_get() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2-; }
[[ -f .env ]] || { echo "deploy aborted: no .env in $PWD"; exit 1; }
[[ -s riot.key ]] || { echo "deploy aborted: no riot.key in $PWD"; exit 1; }
[[ $(stat -c %a riot.key 2>/dev/null || stat -f %Lp riot.key) == 600 ]] || { echo "deploy aborted: riot.key is not mode 600"; exit 1; }
current=$(env_get IMAGE_TAG)
previous=$(env_get PREVIOUS_IMAGE_TAG)

if [[ $first -eq 0 ]]; then
  bash bin/backup.sh --prefix premigrate --name "$new" || { echo "deploy aborted: premigrate backup failed"; exit 1; }
fi

# .env.next: IMAGE_TAG moves to the new tag; PREVIOUS_IMAGE_TAG moves only when the tag
# changes, so a retry never forgets the real previous release.
next_previous=$previous
[[ $new != "$current" && -n $current ]] && next_previous=$current
umask 077
awk -v tag="$new" -v prev="$next_previous" '
  /^IMAGE_TAG=/ { print "IMAGE_TAG=" tag; seen_t = 1; next }
  /^PREVIOUS_IMAGE_TAG=/ { print "PREVIOUS_IMAGE_TAG=" prev; seen_p = 1; next }
  { print }
  END { if (!seen_t) print "IMAGE_TAG=" tag; if (!seen_p) print "PREVIOUS_IMAGE_TAG=" prev }
' .env > .env.next || { rm -f .env.next; echo "deploy aborted: could not write .env.next"; exit 1; }

if ! "${compose[@]}" --env-file .env.next --profile ops run --rm -T migrate; then
  rm -f .env.next
  echo "deploy aborted: migrate failed; .env unchanged"
  exit 1
fi
mv .env.next .env

"${compose[@]}" up -d --remove-orphans || { echo "deploy: up failed; bin/rollback.sh returns to ${next_previous:-nothing}"; exit 1; }

healthy=0
for _ in $(seq 1 $(( wait_s / 5 ))); do
  status=$("${compose[@]}" ps --format '{{.Service}} {{.Health}}' web api worker)
  if [[ $(grep -c ' healthy$' <<< "$status") -eq 3 ]]; then healthy=1; break; fi
  sleep "${DEPLOY_POLL_S:-5}"
done
"${compose[@]}" ps
if [[ $healthy -ne 1 ]]; then
  echo "deploy: web, api and worker not all healthy after ${wait_s} s; bin/rollback.sh returns to ${next_previous:-nothing}"
  exit 1
fi

for repo in arena-ranking-api arena-ranking-worker arena-ranking-web; do
  for tag in $(sudo docker images "$repo" --format '{{.Tag}}'); do
    [[ $tag == "$new" || $tag == "$next_previous" ]] && continue
    sudo docker rmi "$repo:$tag"
  done
done
echo "deployed $new (previous ${next_previous:-none})"
