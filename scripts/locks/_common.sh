#!/bin/sh
# _common.sh — shared helpers for the lock-guard scripts. SOURCED, not executed.
# Provides: encode_path(), now(), resolve_lock_dir() [sets LOCK_DIR].
#
# Parity with the VM LOCK-VM contract: path '/' -> '__', mkdir-atomic locks
# under <repo-root>/.locks. Native ext4 only (confirmed in LOCK-WSL Phase 0).

encode_path() {
  # Replace every '/' with '__' (so app/page.tsx -> app__page.tsx).
  # KNOWN EDGE (matches VM contract by design): a literal path containing '__'
  # collides with a '/'-encoded path (a/b and a__b both -> a__b.lock). Accepted.
  printf '%s' "$1" | sed 's#/#__#g'
}

now() { date +%s; }

resolve_lock_dir() {
  # Precedence: explicit $LOCK_DIR (tests) > <this file's repo>/.locks
  #
  # 🚨 THE LOCK ROOT IS DERIVED FROM THIS FILE'S OWN LOCATION, NEVER FROM $PWD.
  #
  # It used to be `git rev-parse --show-toplevel`, falling back to `$(pwd)/.locks`.
  # That is a FALSE-CLEAN generator: run any lock script from a directory that is
  # not a git repo — `$HOME`, `/tmp`, or the landing directory of an `ssh` pipe —
  # and the git call fails, the root silently becomes `$PWD`, and lock_status.sh
  # reports "no active locks" for a lock directory that does not exist. Measured
  # here before the fix: from the repo it listed 21 held locks; from `$HOME` the
  # SAME command said "no active locks at /home/ghost/.locks".
  #
  # A clean bill of health for a directory nobody looked in is worse than an
  # error, because it is indistinguishable from a real all-clear. The VM's
  # `_lock_common.sh` carries the same defect from the same line, and it was
  # already hiding a real leaked lock there.
  #
  # The lock scripts live in <repo>/scripts/locks/, so the repo root is two
  # levels up from this file — a fact that cannot depend on where the caller
  # happens to stand.
  if [ -n "${LOCK_DIR:-}" ]; then
    return 0
  fi
  # bash sets BASH_SOURCE to this sourced file. Under POSIX sh (dash) there is no
  # such variable and $0 is the SOURCING script — which lives in this same
  # directory, so the derivation holds either way.
  if [ -n "${BASH_SOURCE:-}" ]; then
    _self="${BASH_SOURCE}"
  else
    _self="$0"
  fi
  _here=$(CDPATH= cd -- "$(dirname -- "$_self")" && pwd) || return 1
  _root=$(CDPATH= cd -- "$_here/../.." && pwd) || return 1
  LOCK_DIR="$_root/.locks"
}
