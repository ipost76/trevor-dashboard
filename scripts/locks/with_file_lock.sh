#!/bin/sh
# with_file_lock.sh <relpath> -- <command...>
#
# Acquire the per-file lock, run <command...>, then release it via a trap so the
# release fires even if the command fails or the shell is interrupted.
#
# Exit: <command>'s exit code | 1 usage | 2 acquire failed.
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$DIR/_common.sh"

rel="${1:-}"
[ -n "$rel" ] || { echo "usage: with_file_lock.sh <relpath> -- <command...>" >&2; exit 1; }
shift
[ "${1:-}" = "--" ] || { echo "with_file_lock: expected '--' before the command" >&2; exit 1; }
shift
[ "$#" -ge 1 ] || { echo "with_file_lock: no command given after '--'" >&2; exit 1; }

owner="${PROMPT_ID:-$$}"
resolve_lock_dir
export LOCK_DIR
export LOCK_HOLDER_PID="$$"   # this process holds the lock for the command's life

"$DIR/lock_acquire.sh" "$rel" "$owner" || exit 2
trap '"$DIR/lock_release.sh" "$rel" "$owner" >/dev/null 2>&1 || true' EXIT INT TERM

rc=0
"$@" || rc=$?
exit "$rc"
