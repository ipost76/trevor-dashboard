#!/bin/sh
# lock_acquire.sh <path> [owner-id] [stale-secs]
#
# Atomically claim a per-file lock via mkdir (atomic on native ext4). On a held
# lock, reclaim ONLY when age > stale-secs (default 900) AND the owner is
# definitively DEAD. Otherwise block, retrying every LOCK_RETRY (default 2s) up
# to LOCK_MAX_WAIT (default 600s), then fail loud.
#
# Exit: 0 claimed | 1 usage/unresolvable path | 2 timed out.
#
# <path> may be repo-relative or absolute, in ANY spelling — it is canonicalised
# to one absolute key before encoding (lock_key), so two sessions naming the same
# file differently collide on the same lock instead of both winning.
#
# meta line: <owner> <epoch> <durable-pid> <shell-pid> <host>
#   owner       = <PROMPT_ID>/<session-token>, or the exact literal given as $2
#   durable-pid = the session-durable holder; stale-reclaim liveness reads THIS
#   shell-pid   = the one-shot claiming shell, diagnostics only (never liveness)
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$DIR/_common.sh"

rel="${1:-}"
[ -n "$rel" ] || { echo "usage: lock_acquire.sh <path> [owner-id] [stale-secs]" >&2; exit 1; }
owner="${2:-}"
[ -n "$owner" ] || owner=$(lock_owner_id)
stale="${3:-${LOCK_STALE:-900}}"
max_wait="${LOCK_MAX_WAIT:-600}"
retry="${LOCK_RETRY:-2}"
holder_pid=$(lock_durable_pid)
self_host=$(lock_host)

resolve_lock_dir
mkdir -p "$LOCK_DIR"

encoded=""
encoded=$(lock_key "$rel") || true
[ -n "$encoded" ] || { echo "lock_acquire: cannot resolve a lock key for '$rel'" >&2; exit 1; }
lock_dir="$LOCK_DIR/${encoded}.lock"
meta="$lock_dir/meta"

deadline=$(( $(now) + max_wait ))

while :; do
  if mkdir "$lock_dir" 2>/dev/null; then
    printf '%s %s %s %s %s\n' "$owner" "$(now)" "$holder_pid" "$$" "$self_host" > "$meta"
    exit 0
  fi

  # Held. Inspect meta for stale-reclaim eligibility.
  m_owner=""; m_epoch=""; m_pid=""; m_shell=""; m_host=""
  if [ -f "$meta" ]; then
    read m_owner m_epoch m_pid m_shell m_host < "$meta" 2>/dev/null || true
  fi

  reclaim=0
  case "$m_epoch" in
    ''|*[!0-9]*) : ;;   # missing / unparseable -> lock is mid-init; never steal
    *)
      age=$(( $(now) - m_epoch ))
      if [ "$age" -gt "$stale" ]; then
        # 🚨 FAIL TOWARD NOT STEALING. Only a DEFINITELY-dead holder is
        # reclaimable. An absent, unparseable or foreign-host pid reads ALIVE.
        if lock_pid_alive "$m_pid" "$m_host"; then
          reclaim=0   # alive or indeterminate -> never steal, however old
        else
          reclaim=1   # old AND definitively dead -> reclaimable
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
