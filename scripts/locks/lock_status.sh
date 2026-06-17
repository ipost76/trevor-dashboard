#!/bin/sh
# lock_status.sh — read-only diagnostic: list every lock with owner, age, and
# whether the holder PID is still alive. Never mutates anything. Exit 0.
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$DIR/_common.sh"

resolve_lock_dir
if [ ! -d "$LOCK_DIR" ]; then
  echo "no locks (.locks absent at $LOCK_DIR)"
  exit 0
fi

found=0
for d in "$LOCK_DIR"/*.lock; do
  [ -d "$d" ] || continue
  found=1
  name=$(basename "$d")
  meta="$d/meta"
  if [ -f "$meta" ]; then
    o=""; e=""; p=""
    read o e p < "$meta" 2>/dev/null || true
    case "$e" in
      ''|*[!0-9]*) age="?" ;;
      *) age="$(( $(now) - e ))s" ;;
    esac
    if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then alive="ALIVE"; else alive="DEAD"; fi
    printf '%-44s owner=%-18s pid=%-8s age=%-8s holder=%s\n' "$name" "${o:-?}" "${p:-?}" "$age" "$alive"
  else
    printf '%-44s (initializing — no meta yet)\n' "$name"
  fi
done
[ "$found" = 1 ] || echo "no active locks at $LOCK_DIR"
exit 0
