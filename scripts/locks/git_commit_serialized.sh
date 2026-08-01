#!/bin/sh
# git_commit_serialized.sh -- <command string>
#
# Run <command string> as ONE unit inside the global git-index lock so only one
# committer touches the index at a time. Pass the command as a single quoted
# string (VM-parity "quoted-string form") so a compound 'git add X && git commit
# ...' runs atomically under the lock rather than being split on '&&' by the
# caller's shell (which would leave the commit OUTSIDE the lock).
#
#   git_commit_serialized.sh -- "git add path/file && git commit -m 'msg'"
#
# Refuses bare 'git add .' / 'git add -A' / 'git add --all' (stage-everything),
# even when prefixed with 'git -C <dir>'. Exit: <cmd> code | 1 usage | 2 acquire
# failed | 3 refused.
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$DIR/_common.sh"

[ "${1:-}" = "--" ] || { echo "usage: git_commit_serialized.sh -- <command string>" >&2; exit 1; }
shift
cmd="$*"
[ -n "$cmd" ] || { echo "git_commit_serialized: empty command" >&2; exit 1; }

# --- Refuse staging the whole tree -------------------------------------------
# Split the command into segments on && || ; then, per segment that invokes a
# real 'git' word, refuse if an 'add' stages a bare . / -A / --all token. This
# tolerates 'git -C <dir> add .' (options between git and add).
refuse=0
segs=$(printf '%s' "$cmd" | sed 's/&&/\n/g; s/||/\n/g; s/;/\n/g')
oldifs=$IFS
IFS='
'
for seg in $segs; do
  # consider only segments that contain a standalone 'git' word
  printf '%s ' "$seg" | grep -Eq '(^|[^[:alnum:]_])git([[:space:]]|$)' || continue
  if printf '%s ' "$seg" | grep -Eq '[[:space:]]add([[:space:]]+[^[:space:]]+)*[[:space:]]+(\.|-A|--all)([[:space:]]|$)'; then
    refuse=1
    break
  fi
done
IFS=$oldifs
if [ "$refuse" = 1 ]; then
  echo "git_commit_serialized: REFUSED bare 'git add .' / -A / --all — stage specific paths only" >&2
  exit 3
fi
# -----------------------------------------------------------------------------

GITLOCK="__git_index__"
resolve_lock_dir
export LOCK_DIR
# Holder pid first, then the owner — see with_file_lock.sh for why the order
# matters (the session token is derived from the durable pid).
export LOCK_HOLDER_PID="$$"
owner=$(lock_owner_id)

"$DIR/lock_acquire.sh" "$GITLOCK" "$owner" || exit 2
trap '"$DIR/lock_release.sh" "$GITLOCK" "$owner" >/dev/null 2>&1 || true' EXIT INT TERM

rc=0
sh -c "$cmd" || rc=$?
exit "$rc"
