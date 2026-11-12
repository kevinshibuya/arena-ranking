#!/usr/bin/env bash
# Ships a release from Kevin's Mac to the box: this directory's files to ~/apps/arena-ranking/
# and the three images into the box's Docker, over SSH. No registry, no build on the box.
#
#   BOX=ubuntu@<box-ip> SSH_KEY=<key path> bin/ship.sh <tag> [--dry-run]
#
# BOX and SSH_KEY (the private key's path) come from the operator's shell; the IP is never in
# this repo. A -dirty tag is refused: what reaches the box names a commit.
# --dry-run writes both tarballs to $SCRATCH, lists the files and prints the commands it would
# run, without touching the box.
set -euo pipefail

SCRATCH="${SCRATCH:-$(mktemp -d)}"
here="$(cd "$(dirname "$0")/.." && pwd)"
usage="usage: BOX=ubuntu@<box-ip> bin/ship.sh <tag> [--dry-run]"
tag="" dry=0
for arg in "$@"; do
  case $arg in
    --dry-run) dry=1 ;;
    -*) echo "$usage" >&2; exit 2 ;;
    *) tag=$arg ;;
  esac
done
[[ -n $tag ]] || { echo "$usage" >&2; exit 2; }
[[ $tag != *-dirty ]] || { echo "refusing $tag: commit, then pnpm images:build" >&2; exit 1; }
key="${SSH_KEY:-}"
box="${BOX:-}"
[[ $dry -eq 1 || -n $box ]] || { echo "set BOX=ubuntu@<box-ip>" >&2; exit 2; }
[[ $dry -eq 1 || -n $key ]] || { echo "set SSH_KEY to the path of the box's SSH key" >&2; exit 2; }
key="${key:-<SSH_KEY>}"

images=("arena-ranking-api:$tag" "arena-ranking-worker:$tag" "arena-ranking-web:$tag")
for image in "${images[@]}"; do
  docker image inspect "$image" >/dev/null 2>&1 || { echo "missing image $image: run pnpm images:build first" >&2; exit 1; }
done

# The files: no macOS ._* files or xattrs, no secrets, no box state, no Mac-only tests.
files_tgz="$SCRATCH/arena-ranking-files-$tag.tgz"
COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -C "$here" \
  --exclude ./.env --exclude ./riot.key --exclude ./state --exclude ./test -czf "$files_tgz" .
images_tgz="$SCRATCH/arena-ranking-$tag.tgz"
docker save "${images[@]}" | gzip > "$images_tgz"

size() { wc -c < "$1" | tr -d ' '; }
echo "files tarball  $(size "$files_tgz") bytes  $files_tgz"
echo "images tarball $(size "$images_tgz") bytes  $images_tgz  (${images[*]})"

remote_files='mkdir -p ~/apps/arena-ranking/state/backup && tar -C ~/apps/arena-ranking -xzf -'
remote_load="gunzip -c /tmp/arena-ranking-$tag.tgz | sudo docker load && rm /tmp/arena-ranking-$tag.tgz"
remote_sizes="sudo docker images 'arena-ranking-*' --format '{{.Repository}}:{{.Tag}} {{.Size}}'"

if [[ $dry -eq 1 ]]; then
  echo "--- files in the tarball"
  tar -tzf "$files_tgz" | sed 's|^\./||' | grep -v '^$' | sort
  echo "--- would run"
  echo "ssh -i $key ${box:-<BOX>} '$remote_files' < $files_tgz"
  echo "scp -i $key $images_tgz ${box:-<BOX>}:/tmp/"
  echo "ssh -i $key ${box:-<BOX>} '$remote_load'"
  echo "ssh -i $key ${box:-<BOX>} \"$remote_sizes\""
  exit 0
fi

ssh -i "$key" "$box" "$remote_files" < "$files_tgz"
scp -i "$key" "$images_tgz" "$box:/tmp/"
ssh -i "$key" "$box" "$remote_load"
ssh -i "$key" "$box" "$remote_sizes"
rm -f "$files_tgz" "$images_tgz"
