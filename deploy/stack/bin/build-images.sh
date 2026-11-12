#!/usr/bin/env bash
# Builds the three images for linux/arm64 on Kevin's Mac: arena-ranking-api and
# arena-ranking-worker from apps/backend/Dockerfile, arena-ranking-web from
# apps/web/Dockerfile. Nothing is pushed anywhere and nothing is built on the box:
# bin/ship.sh carries the images over SSH. `pnpm images:build` runs this.
#
#   bin/build-images.sh [<tag>]
#
# The tag defaults to bin/image-tag.sh: the short commit SHA, -dirty on a dirty tree.
# Each image is checked for arm64 and a non-root user after the build.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(git -C "$here" rev-parse --show-toplevel)"
case ${1:-} in -*) echo "usage: bin/build-images.sh [<tag>]" >&2; exit 2 ;; esac
tag=${1:-$("$here/image-tag.sh")}

build() { docker buildx build --load --platform linux/arm64 "$@"; }
build -f "$repo/apps/backend/Dockerfile" --target api -t "arena-ranking-api:$tag" "$repo"
build -f "$repo/apps/backend/Dockerfile" --target worker -t "arena-ranking-worker:$tag" "$repo"
build -f "$repo/apps/web/Dockerfile" -t "arena-ranking-web:$tag" "$repo"

for name in api worker web; do
  image="arena-ranking-$name:$tag"
  read -r arch user <<< "$(docker image inspect --format '{{.Architecture}} {{.Config.User}}' "$image")"
  [[ $arch == arm64 ]] || { echo "$image is $arch, not arm64" >&2; exit 1; }
  [[ -n $user && $user != root && $user != 0 ]] || { echo "$image runs as root" >&2; exit 1; }
  echo "$image  $arch  user=$user  $(docker image inspect --format '{{.Size}}' "$image" | awk '{ printf "%.0f MB", $1 / 1e6 }')"
done
