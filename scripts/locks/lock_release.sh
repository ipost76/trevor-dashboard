#!/bin/sh
# lock_release.sh <relpath> [owner-id]
#
# Release a per-file lock ONLY if this owner holds it. Idempotent: releasing a
# lock you don't hold (or that isn't held) is a no-op, never an error.
#
# Exit: 0 (released or no-op) | 1 usage.
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$DIR/_common.sh"

rel="${1:-}"
[ -n "$rel" ] || { echo "usage: lock_release.sh <relpath> [owner-id]" >&2; exit 1; }
owner="${2:-${PROMPT_ID:-$PPID}}"

resolve_lock_dir
encoded=$(encode_path "$rel")
lock_dir="$LOCK_DIR/${encoded}.lock"
meta="$lock_dir/meta"

[ -d "$lock_dir" ] || exit 0   # not held -> idempotent no-op

m_owner=""
if [ -f "$meta" ]; then
  read m_owner _rest < "$meta" 2>/dev/null || true
fi

if [ "$m_owner" = "$owner" ]; then
  rm -rf "$lock_dir"
  exit 0
fi

echo "lock_release: '$rel' held by owner=${m_owner:-?}, not '$owner' — no-op" >&2
exit 0
