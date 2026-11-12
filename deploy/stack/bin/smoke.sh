#!/usr/bin/env bash
# `pnpm stack:smoke`: runs the production compose file on the Mac, as the box would, with a
# throwaway .env and riot.key and the fake upstream standing in for Riot (test/compose.smoke.yml).
#
#   bin/smoke.sh [<tag>]
#
# Needs the images from `pnpm images:build` at the same tag (bin/image-tag.sh by default).
# In order: checks the rendered config (test/check-compose.mjs); creates the Caddy network `web`
# if missing; copies this directory to a scratch directory, as bin/ship.sh does to the box;
# migrates; brings the stack up and waits for every healthcheck; checks the key file is readable
# in api and worker, that no container runs as root, that /api/health answers ok through the web
# container's rewrite and that the home page renders; then brings everything down, volumes
# included, and checks nothing is left. The stack comes down whether the checks pass or fail.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(git -C "$here" rev-parse --show-toplevel)"
case ${1:-} in -*) echo "usage: bin/smoke.sh [<tag>]" >&2; exit 2 ;; esac
tag=${1:-$("$here/bin/image-tag.sh")}
project="arena-smoke-$$"

for name in api worker web; do
  docker image inspect "arena-ranking-$name:$tag" >/dev/null 2>&1 \
    || { echo "missing image arena-ranking-$name:$tag: run pnpm images:build first" >&2; exit 1; }
done

scratch=$(mktemp -d)
stack="$scratch/stack"
compose() { (cd "$stack" && COMPOSE_PROJECT_NAME=$project COMPOSE_FILE=compose.yaml:test/compose.smoke.yml docker compose "$@"); }
down() {
  status=$?
  if [[ $status -ne 0 && -d $stack ]]; then
    echo "--- logs" >&2
    compose --profile ops logs --no-color --tail 40 >&2 || true
  fi
  [[ -d $stack ]] && compose --profile ops down --volumes --remove-orphans --timeout 10 >/dev/null 2>&1
  rm -rf "$scratch"
  exit "$status"
}
trap down EXIT
step() { echo "--- $*"; }

cp -R "$here" "$stack"
key="RGAPI-smoke-$$"
printf '%s' "$key" > "$stack/riot.key"
chmod 600 "$stack/riot.key"
umask 077
cat > "$stack/.env" <<ENV
IMAGE_TAG=$tag
PREVIOUS_IMAGE_TAG=
APP_UID=$(id -u)
APP_GID=$(id -g)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
REDIS_PASSWORD=$(openssl rand -hex 16)
DASHBOARD_USER=
DASHBOARD_PASS=
R2_BUCKET=smoke
ENV

step "config"
(cd "$stack" && docker compose -p "$project" --profile ops config --format json) > "$scratch/config.json"
node "$here/test/check-compose.mjs" "$scratch/config.json" "$here/compose.yaml"

step "network web"
docker network inspect web >/dev/null 2>&1 || docker network create web

step "fake upstream image"
docker buildx build --quiet --load --platform linux/arm64 -f "$repo/apps/fake-upstream/Dockerfile" \
  -t arena-ranking-fake-upstream:smoke "$repo" >/dev/null

step "migrate"
compose --profile ops run --rm -T migrate

step "up"
compose up -d --wait --wait-timeout 180
compose ps --format '{{.Service}} {{.Status}}'

step "key file"
for name in api worker; do
  read_key=$(compose exec -T "$name" node -e 'process.stdout.write(require("fs").readFileSync(process.env.RIOT_KEY_FILE, "utf8"))')
  [[ $read_key == "$key" ]] || { echo "$name cannot read the key file" >&2; exit 1; }
  echo "$name reads RIOT_KEY_FILE"
done

step "non-root"
for name in api worker web; do
  uid=$(compose exec -T "$name" id -u)
  [[ $uid != 0 ]] || { echo "$name runs as root" >&2; exit 1; }
  echo "$name runs as uid $uid"
done

# From inside the web container, so the request takes the /api/* rewrite to the api service.
web_get() {
  compose exec -T web node -e '
    fetch("http://127.0.0.1:3000" + process.argv[1]).then(async (r) => {
      process.stdout.write(await r.text());
      process.exit(r.ok ? 0 : 1);
    }, (e) => { console.error(e); process.exit(1); });' "$1"
}

step "health through the web rewrite"
health=$(web_get /api/health)
node -e '
  const health = JSON.parse(process.argv[1]);
  if (health.process?.status !== "ok") { console.error("health is not ok:", process.argv[1]); process.exit(1); }
  console.log("process ok, riot key " + health.ops?.riotKey);' "$health"

step "home page"
home=$(web_get /)
grep -q '<h1[^>]*>Arena Ranking</h1>' <<< "$home" || { echo "the home page has no heading" >&2; exit 1; }
grep -q "isn&#x27;t endorsed by Riot Games\|isn't endorsed by Riot Games" <<< "$home" \
  || { echo "the home page has no disclaimer" >&2; exit 1; }
echo "home page renders with its heading and the disclaimer"

step "down"
compose --profile ops down --volumes --remove-orphans --timeout 10
left=$(docker ps -aq --filter "label=com.docker.compose.project=$project"; docker volume ls -q --filter "label=com.docker.compose.project=$project")
[[ -z $left ]] || { echo "left behind: $left" >&2; exit 1; }
echo "stack:smoke ok"
