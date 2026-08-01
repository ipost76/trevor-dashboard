#!/bin/sh
# _common.sh — shared helpers for the lock-guard scripts. SOURCED, not executed.
#
# Provides: encode_path(), lock_canonicalize(), lock_key(), now(),
#           resolve_repo_root() [sets LOCK_REPO_ROOT], resolve_lock_dir() [sets LOCK_DIR],
#           lock_durable_pid(), lock_session_token(), lock_owner_label(), lock_owner_id(),
#           lock_host(), lock_liveness(), lock_pid_alive().
#
# Parity with the VM LOCK-VM contract: path '/' -> '__', mkdir-atomic locks
# under <repo-root>/.locks. Native ext4 only (confirmed in LOCK-WSL Phase 0).
#
# 🚨 THE ONE ROOT DEFECT THIS FILE EXISTS TO CLOSE (B1, 2026-08-01):
#   the lock used to identify OWNERS and KEYS from AMBIENT STATE — the caller's
#   $(pwd), the caller's $PPID, the caller's argument SPELLING, and an
#   unnamespaced label. Every helper below derives identity from something the
#   caller cannot accidentally vary. Nothing here changes HOW a lock is acquired
#   (atomic mkdir on the encoded path is untouched) — only how the root and key
#   are resolved, how release verifies ownership, and how liveness is judged.

encode_path() {
  # Replace every '/' with '__' (so /a/b/c.tsx -> __a__b__c.tsx).
  # KNOWN EDGE (matches VM contract by design): a literal path containing '__'
  # collides with a '/'-encoded path (a/b and a__b both -> a__b.lock). Accepted.
  printf '%s' "$1" | sed 's#/#__#g'
}

now() { date +%s; }

lock_host() { hostname 2>/dev/null || echo unknown; }

resolve_repo_root() {
  # Sets LOCK_REPO_ROOT from THIS FILE's own location. Never from $(pwd), and
  # never from a bare `git rev-parse` (a caller standing in a DIFFERENT git repo
  # would resolve a different, equally wrong root).
  if [ -n "${LOCK_REPO_ROOT:-}" ]; then
    return 0
  fi
  # bash sets BASH_SOURCE to this sourced file. Under POSIX sh (dash) there is no
  # such variable; every lock script sets $DIR to its own directory before
  # sourcing us, and $0 is the SOURCING script — which lives in that same
  # directory. So the derivation holds under bash, dash, and an ssh-pipe landing.
  if [ -n "${BASH_SOURCE:-}" ]; then
    _rr_self="${BASH_SOURCE}"
    _rr_here=$(CDPATH= cd -- "$(dirname -- "$_rr_self")" && pwd) || _rr_here=""
  elif [ -n "${DIR:-}" ]; then
    _rr_here="$DIR"
  else
    _rr_self="$0"
    _rr_here=$(CDPATH= cd -- "$(dirname -- "$_rr_self")" && pwd) || _rr_here=""
  fi
  if [ -z "$_rr_here" ]; then
    echo "lock: FATAL — cannot resolve the lock helper's own directory" >&2
    return 1
  fi
  # The lock scripts live in <repo>/scripts/locks/, so the repo root is two
  # levels up — a fact that cannot depend on where the caller happens to stand.
  _rr_root=$(CDPATH= cd -- "$_rr_here/../.." && pwd) || _rr_root=""
  if [ -z "$_rr_root" ] || [ ! -e "$_rr_root/.git" ]; then
    # 🚨 NO $(pwd) FALLBACK. An unresolvable root FAILS LOUD rather than
    # silently becoming the caller's cwd — a clean bill of health for a
    # directory nobody looked in is worse than an error, because it is
    # indistinguishable from a real all-clear.
    echo "lock: FATAL — repo root '$_rr_root' has no .git marker (refusing to guess)" >&2
    return 1
  fi
  LOCK_REPO_ROOT="$_rr_root"
}

resolve_lock_dir() {
  # Precedence: explicit $LOCK_DIR (tests) > <this file's repo>/.locks
  if [ -n "${LOCK_DIR:-}" ]; then
    return 0
  fi
  resolve_repo_root || return 1
  LOCK_DIR="$LOCK_REPO_ROOT/.locks"
}

lock_canonicalize() {
  # Resolve <path> to an ABSOLUTE, lexically-normalised path.
  #
  # 🚨 THIS IS THE BYPASS FIX (L-6). Before it, the key was the caller's raw
  # argument string, so ONE file had as many locks as it had spellings —
  # measured on this box: 'src/app/page.tsx', './src/app/page.tsx', the absolute
  # path, and 'app/page.tsx' from src/ produced FOUR independent locks and THREE
  # of them were acquired concurrently. That is not a lying diagnostic; it is no
  # mutual exclusion at all.
  #
  # A RELATIVE path anchors at the REPO ROOT — never at $(pwd), which is the
  # ambient-state defect wearing a different hat. Symlinks are deliberately NOT
  # resolved: normalisation is lexical, so the key is a pure function of the
  # path and cannot change under a filesystem edit.
  _lc_in="${1:-}"
  [ -n "$_lc_in" ] || return 1
  case "$_lc_in" in
    /*) _lc_abs="$_lc_in" ;;
    *)  resolve_repo_root || return 1
        _lc_abs="$LOCK_REPO_ROOT/$_lc_in" ;;
  esac
  # Lexical normalisation: collapse '//', drop '/./', resolve '/../'.
  # 'set -f' so a segment containing a glob char cannot be expanded against the
  # filesystem during the unquoted split.
  _lc_out=""
  _lc_oldifs=$IFS
  set -f
  IFS=/
  for _lc_seg in $_lc_abs; do
    case "$_lc_seg" in
      ''|.) continue ;;
      ..)   _lc_out="${_lc_out%/*}" ;;
      *)    _lc_out="$_lc_out/$_lc_seg" ;;
    esac
  done
  IFS=$_lc_oldifs
  set +f
  [ -n "$_lc_out" ] || _lc_out="/"
  printf '%s' "$_lc_out"
}

lock_key() {
  # The one entry point every caller uses: canonicalise, THEN encode.
  # Because every canonical path is absolute, every key begins with '__' — so a
  # dot-prefixed lock directory (which the lock_status.sh glob could not see)
  # is now structurally impossible.
  _lk_canon=$(lock_canonicalize "$1") || return 1
  encode_path "$_lk_canon"
}

lock_durable_pid() {
  # The pid recorded as the HOLDER. It must outlive the claiming operation:
  # a stale-reclaim decision made on a pid that dies seconds after acquire is
  # made on a signal that is permanently false.
  #
  # 🚨 MEASURED ON THIS BOX (B1) — and this is where the VM's fix does NOT port.
  # F2 resolved a session-durable pid by requiring the caller to be its own
  # session leader. Here EVERY tool-call shell IS its own session leader
  # (sid == pid), so that test stops at the ephemeral shell and silently
  # degrades to exactly the pid it was meant to replace — F2's own regression,
  # arriving by a different route.
  #
  # The rule that works here: walk up the parent chain and take the FIRST
  # ancestor whose SESSION ID DIFFERS from ours. The per-call shell is placed in
  # a fresh session, so the first ancestor outside that session is the process
  # that owns the whole session. Falls back to $PPID if the walk cannot resolve
  # — never to nothing.
  if [ -n "${LOCK_HOLDER_PID:-}" ]; then
    printf '%s' "$LOCK_HOLDER_PID"
    return 0
  fi
  _dp_sid=$(ps -o sid= -p "$$" 2>/dev/null | tr -d ' ')
  if [ -z "$_dp_sid" ]; then
    printf '%s' "$PPID"
    return 0
  fi
  _dp_cur=$$
  _dp_n=0
  while [ "$_dp_n" -lt 32 ]; do
    _dp_par=$(ps -o ppid= -p "$_dp_cur" 2>/dev/null | tr -d ' ')
    case "$_dp_par" in
      ''|0|1|*[!0-9]*) break ;;
    esac
    _dp_psid=$(ps -o sid= -p "$_dp_par" 2>/dev/null | tr -d ' ')
    if [ -z "$_dp_psid" ]; then
      break
    fi
    if [ "$_dp_psid" != "$_dp_sid" ]; then
      printf '%s' "$_dp_par"
      return 0
    fi
    _dp_cur="$_dp_par"
    _dp_n=$((_dp_n + 1))
  done
  printf '%s' "$PPID"   # relaxed fallback — never leave the holder pid empty
}

lock_session_token() {
  # DERIVABLE, never random: it must recompute identically in a later one-shot
  # shell of the same session or release breaks. The durable pid alone would
  # collide across a reboot, so it is paired with that pid's own start time
  # (/proc/<pid>/stat field 22, read comm-safely so a command name containing
  # parentheses cannot shift the field index).
  _lst_pid=$(lock_durable_pid)
  _lst_st=$(awk '{ sub(/^[0-9]+ \(.*\) /, ""); print $20 }' "/proc/$_lst_pid/stat" 2>/dev/null)
  case "$_lst_st" in
    ''|*[!0-9]*) _lst_st=0 ;;
  esac
  printf '%s-%s' "$_lst_pid" "$_lst_st"
}

lock_owner_label() {
  # The human half, kept as the PREFIX so lock_status.sh stays readable.
  printf '%s' "${PROMPT_ID:-$(lock_durable_pid)}"
}

lock_owner_id() {
  # <PROMPT_ID>/<session-token> (L-5). Two unrelated prompts a week apart can no
  # longer claim the same owner string, so a stale-reclaim decision is never
  # made on an ambiguous key.
  printf '%s/%s' "$(lock_owner_label)" "$(lock_session_token)"
}

lock_liveness() {
  # $1=pid  $2=host(optional). Prints ALIVE | DEAD | UNKNOWN.
  #
  # 🚨 WHEN LIVENESS CANNOT BE DETERMINED THE HOLDER IS TREATED AS ALIVE.
  # A leaked lock costs a wait; a wrongly reclaimed lock corrupts a live prompt
  # mid-edit. The old code reclaimed on an empty/unparseable pid — indeterminate
  # meant STEAL, which is the direction that does the damage.
  _ll_pid="${1:-}"
  _ll_host="${2:-}"
  if [ -n "$_ll_host" ] && [ "$_ll_host" != "$(lock_host)" ]; then
    echo UNKNOWN          # another host — kill -0 here means nothing
    return 0
  fi
  case "$_ll_pid" in
    ''|*[!0-9]*) echo UNKNOWN; return 0 ;;
  esac
  if kill -0 "$_ll_pid" 2>/dev/null; then
    echo ALIVE
  else
    echo DEAD
  fi
}

lock_pid_alive() {
  # rc 0 unless liveness is definitively DEAD.
  if [ "$(lock_liveness "${1:-}" "${2:-}")" = DEAD ]; then
    return 1
  fi
  return 0
}
