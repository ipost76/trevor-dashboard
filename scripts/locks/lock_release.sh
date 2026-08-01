#!/bin/sh
# lock_release.sh <path> [owner-id]
#
# Release a per-file lock ONLY if this owner holds it.
#
# Exit: 0 released | 0 no-op (not held) | 1 usage/unresolvable path
#       4 REFUSED — held by a DIFFERENT owner.
#
# 🚨 THE DISTINCTION THAT MATTERS (L-1). "Release must fail loudly" is wrong as
# a blanket rule: idempotency is DELIBERATE, and selftest TEST 3a depends on a
# double release being harmless. The defect was never an absent release — it was
# an owner MISMATCH wearing success's clothes. Measured before this fix: 22
# releases returned rc=0 having released nothing, because PROMPT_ID was not in
# the fresh shell's environment, the owner fell back to $PPID, missed, and took
# the documented no-op branch. Listing the directory is what caught it.
#
#   owner MISMATCH    -> non-zero, message naming BOTH owners, lock UNTOUCHED
#   absent / released -> rc=0, unchanged
#
# NEVER force-release. Releasing someone else's lock is worse than leaking yours.
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$DIR/_common.sh"

rel="${1:-}"
[ -n "$rel" ] || { echo "usage: lock_release.sh <path> [owner-id]" >&2; exit 1; }
owner="${2:-}"
[ -n "$owner" ] || owner=$(lock_owner_id)

resolve_lock_dir
encoded=""
encoded=$(lock_key "$rel") || true
[ -n "$encoded" ] || { echo "lock_release: cannot resolve a lock key for '$rel'" >&2; exit 1; }
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

# Legacy compatibility: a lock claimed BEFORE owners were namespaced carries a
# bare label with no '/' separator. Match it on the label half so a lock held
# across this change is not orphaned. Inert on a box whose .locks/ was empty at
# the cutover — kept because the cost of being wrong is a stranded live lock.
case "$m_owner" in
  */*) : ;;
  *)
    if [ -n "$m_owner" ] && [ "$m_owner" = "$(lock_owner_label)" ]; then
      echo "lock_release: '$rel' — legacy pre-namespace lock owned by '$m_owner'; released on label match" >&2
      rm -rf "$lock_dir"
      exit 0
    fi
    ;;
esac

echo "lock_release: REFUSED — '$rel' is held by owner='${m_owner:-?}', not '$owner'. Lock left intact." >&2
exit 4
