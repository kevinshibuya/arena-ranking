#!/usr/bin/env bash
# Prints the image tag for the current tree: the short commit SHA, with -dirty appended
# while the tree has uncommitted changes. bin/ship.sh refuses a -dirty tag, so only an
# image built from a commit reaches the box.
set -euo pipefail

repo="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
tag=$(git -C "$repo" rev-parse --short HEAD)
[[ -z $(git -C "$repo" status --porcelain) ]] || tag="$tag-dirty"
echo "$tag"
