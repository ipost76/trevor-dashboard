#!/bin/sh
# lock_acquire.sh <relpath> [owner-id] [stale-secs]
#
# Atomically claim a per-file lock via mkdir (atomic on native ext4). On a held
# lock, reclaim ONLY when age > stale-secs (default 900) AND the owner PID is
# dead (kill -0). Otherwise block, retrying every LOCK_RETRY (default 2s) up to
# LOCK_MAX_WAIT (default 600s), then fail loud.
#
# Exit: 0 claimed | 1 usage | 2 timed out.
#
# The recorded PID is the HOLDER's pid (LOCK_HOLDER_PID, default $PPID) — i.e.
# the long-lived process that will hold the lock until release — NOT this
# short-lived acquire process. Stale-reclaim liveness depends on that.
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$DIR/_common.sh"

rel="${1:-}"
[ -n "$rel" ] || { echo "usage: lock_acquire.sh <relpath> [owner-id] [stale-secs]" >&2; exit 1; }
owner="${2:-${PROMPT_ID:-$PPID}}"
stale="${3:-${LOCK_STALE:-900}}"
max_wait="${LOCK_MAX_WAIT:-600}"
retry="${LOCK_RETRY:-2}"
holder_pid="${LOCK_HOLDER_PID:-$PPID}"

resolve_lock_dir
mkdir -p "$LOCK_DIR"

encoded=$(encode_path "$rel")
lock_dir="$LOCK_DIR/${encoded}.lock"
meta="$lock_dir/meta"

deadline=$(( $(now) + max_wait ))

while :; do
  if mkdir "$lock_dir" 2>/dev/null; then
    printf '%s %s %s\n' "$owner" "$(now)" "$holder_pid" > "$meta"
    exit 0
  fi

  # Held. Inspect meta for stale-reclaim eligibility.
  m_owner=""; m_epoch=""; m_pid=""
  if [ -f "$meta" ]; then
    read m_owner m_epoch m_pid < "$meta" 2>/dev/null || true
  fi

  reclaim=0
  case "$m_epoch" in
    ''|*[!0-9]*) : ;;   # missing / unparseable -> lock is mid-init; never steal
    *)
      age=$(( $(now) - m_epoch ))
      if [ "$age" -gt "$stale" ]; then
        if [ -n "$m_pid" ] && kill -0 "$m_pid" 2>/dev/null; then
          reclaim=0   # owner still alive -> never steal, however old
        else
          reclaim=1   # old AND dead -> reclaimable
        fi
      fi
      ;;
  esac

  if [ "$reclaim" = 1 ]; then
    # Atomic rename-aside so two reclaimers can't both win.
    scratch="${lock_dir}.stale.$$.$(now)"
    if mv "$lock_dir" "$scratch" 2>/dev/null; then
      rm -rf "$scratch"
      continue   # path free -> retry mkdir immediately
    fi
    # lost the reclaim race -> fall through and wait
  fi

  if [ "$(now)" -ge "$deadline" ]; then
    echo "lock_acquire: TIMED OUT after ${max_wait}s on '$rel' (held owner=${m_owner:-?} pid=${m_pid:-?})" >&2
    exit 2
  fi
  sleep "$retry"
done
