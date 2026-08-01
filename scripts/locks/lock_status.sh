#!/bin/sh
# lock_status.sh — read-only diagnostic: list every lock with owner, namespace,
# age, and whether the holder is still alive. Never mutates anything. Exit 0.
#
# 🚨 It must tell the truth from ANY working directory — $HOME, /tmp, /, or
# wherever an `ssh` pipe lands — because a clean bill of health for a directory
# nobody looked in is indistinguishable from a real all-clear. The root comes
# from _common.sh's own location, never from $PWD.
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$DIR/_common.sh"

resolve_lock_dir
echo "lock root: $LOCK_DIR"
if [ ! -d "$LOCK_DIR" ]; then
  echo "no locks (.locks absent at $LOCK_DIR)"
  exit 0
fi

found=0
# 🚨 The dot-glob: '*.lock' does NOT match a dot-prefixed name, and a caller
# passing './path' used to mint exactly that — a HELD lock invisible to the only
# diagnostic that verifies locks. Canonicalisation now makes every key start
# '__', so such a name can no longer be created; this second pattern is
# belt-and-braces for any future caller that bypasses lock_key().
for d in "$LOCK_DIR"/*.lock "$LOCK_DIR"/.*.lock; do
  [ -d "$d" ] || continue
  found=1
  name=$(basename "$d")
  meta="$d/meta"
  if [ -f "$meta" ]; then
    o=""; e=""; p=""; s=""; h=""
    read o e p s h < "$meta" 2>/dev/null || true
    case "$e" in
      ''|*[!0-9]*) age="?" ;;
      *) age="$(( $(now) - e ))s" ;;
    esac
    # Split the namespaced owner back into its readable halves.
    case "$o" in
      */*) label="${o%%/*}"; ns="${o#*/}" ;;
      *)   label="${o:-?}";  ns="-" ;;
    esac
    live=$(lock_liveness "$p" "$h")
    printf '%s\n' "$name"
    printf '    owner=%s  ns=%s\n' "$label" "$ns"
    printf '    pid=%s(%s)  shell_pid=%s  host=%s  age=%s\n' \
      "${p:-?}" "$live" "${s:-?}" "${h:-?}" "$age"
  else
    printf '%s\n    (initializing — no meta yet)\n' "$name"
  fi
done
[ "$found" = 1 ] || echo "no active locks at $LOCK_DIR"
exit 0
