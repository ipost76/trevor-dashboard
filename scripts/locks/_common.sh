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
  # Precedence: explicit $LOCK_DIR (tests) > <git-root>/.locks > $PWD/.locks
  if [ -n "${LOCK_DIR:-}" ]; then
    return 0
  fi
  _root=$(git rev-parse --show-toplevel 2>/dev/null || true)
  if [ -n "$_root" ]; then
    LOCK_DIR="$_root/.locks"
  else
    LOCK_DIR="$(pwd)/.locks"
  fi
}
