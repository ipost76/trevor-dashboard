#!/usr/bin/env bash
# =============================================================================
# wave_d_repoint.sh — THE ATOMIC CROSS-BOX REPOINT. **STAGED BY C4, FIRED BY WAVE D.**
#
# 🚨🚨 THIS SCRIPT IS NOT ARMED. It refuses to apply anything unless THREE
#      independent authorisations are present at once (see REFUSAL below). C4 built,
#      dry-ran and proved it; C4 did NOT fire it. The Hub reads the VM until Ghost
#      says otherwise.
#
# WHAT IT DOES
#   Moves all 30 repoint rows from A7 §11 in ONE change, with a matching rollback.
#
# 🚨 WHY IT MUST BE ONE CHANGE, NOT A SEQUENCE.
#   During the shadow week BOTH boxes are alive. An unrepointed VM_GATEWAY_IP means
#   a killswitch.set or promotion.approve from the Hub UI lands in the VM's DB — a
#   copy that becomes divergent and unread. So VM_GATEWAY_IP (#6) must move in the
#   SAME change as TREVOR_DB_PATH's filler (#17-#19) and the ssh pipe (#1-#3).
#   **A Hub READING ghostbox while WRITING the VM is the worst of the three possible
#   states, and it is exactly what a partial repoint produces.** Half a repoint is
#   worse than none. That is why this is a script and not a checklist.
#
# 🚨 THE TARGET IS THE CONTAINER, NOT THE HOST.
#   A7 §11 says "NEW = ghostbox / 100.110.77.115". That is ghostbox THE HOST. Both
#   TREVOR services run inside the Incus container `trevor-prime-3`, which holds its
#   own tailnet address 100.89.253.42 (C1 settled this — INSTALL.md §"A7 §5.1").
#   Everything here targets the CONTAINER.
#
# 🚨 ROW #2/#19 — USER `trevor`, AND NO `sudo -u trevor` WRAPPER. (Ghost, approved
#   2026-08-10.) The VM pipe is `User ghost` + far-side `sudo -n -u trevor`. The
#   container has ONLY the user `trevor` (getent: uid 1000, and /home holds just
#   trevor), so the wrapper is either redundant or demands passwordless-sudo-to-self,
#   and neither is worth carrying. **A future reader will see the VM's ghost+sudo
#   form and be tempted to "restore" it — do not. It was removed deliberately.**
#
# USAGE
#   ./wave_d_repoint.sh                 # DRY RUN (default) — prints all 30 rows, writes nothing
#   ./wave_d_repoint.sh --dry-run       # the same, explicitly
#   ./wave_d_repoint.sh --dry-apply     # 🚨 THE PRE-APPLY GATE — see below
#   ./wave_d_repoint.sh --apply         # REFUSED unless all three authorisations are present
#   ./wave_d_repoint.sh --rollback      # restore every file from the backup manifest
#   ./wave_d_repoint.sh --assert        # run the 11 SILENT-row post-flip assertions
#
# 🚨 --dry-apply IS THE PRE-APPLY GATE, AND --apply RUNS IT AUTOMATICALLY.
#   A DRY RUN PRINTS INTENTIONS; IT NEVER PRINTS OUTCOMES. That distinction is not
#   pedantic — it is why this script reached the edge of Wave D carrying two blocking
#   defects that the dry run reported as fine (A5 F-1/F-2, master B-26/B-27):
#     · row 8's sed did not merely fail, it PREPENDED to all 204 lines of middleware.ts
#       (the auth gate) and still left row 8 unmoved;
#     · row 23 had a post-flip assertion and NO implementation at all.
#   --dry-apply copies the four targets to scratch under /home/ghost/tmp, runs the REAL
#   apply against the copies, and diffs the RESULT against each row's intent. It proves
#   it touched nothing live by sha256 before and after. --apply will not proceed unless
#   it passes. Run it standalone any time; it is read-only with respect to every live file.
#
# REFUSAL — the mechanism, stated (three independent gates, ALL required):
#   1. the flag           --apply
#   2. an env var         REPOINT_AUTHORIZED=WAVE-D
#   3. a sentinel file    /home/ghost/.repoint-authorized  containing exactly WAVE-D
#   A stray invocation, a tab-completion accident, or a cron misfire during the
#   shadow week satisfies AT MOST ONE of these and exits 3 without touching a byte.
#   The sentinel cannot be created by this script — it is Ghost's hand, by design.
# =============================================================================
set -uo pipefail

REPO="/home/ghost/projects/trevor-dashboard"
SSH_CONFIG="/home/ghost/.ssh/config"
ENV_LOCAL="${REPO}/.env.local"
MIDDLEWARE="${REPO}/src/middleware.ts"
TAILSYNC="${REPO}/deploy/scripts/trevor-tailsync.sh"
SENTINEL="/home/ghost/.repoint-authorized"
BACKUP_DIR="/home/ghost/repoint-backups"

# ── SCRATCH REDIRECTION — used ONLY by --dry-apply ────────────────────────────
# 🚨 When REPOINT_DRY_APPLY_ROOT is set, EVERY path above is redirected under it,
#   INCLUDING the sentinel. That is deliberate: --dry-apply has to satisfy all three
#   gates to exercise the real apply path, and it must not do that by creating the
#   real sentinel.
# 🚨 THE ROOT IS REFUSED UNLESS IT SITS UNDER /home/ghost/tmp/. That bound is what
#   makes it safe to let the sentinel move — a caller who can set this variable still
#   cannot authorise a real apply, because every path it can name is scratch.
#   (/home, never /tmp: the house rule, and /tmp is noexec on the VM.)
DRY_ROOT="${REPOINT_DRY_APPLY_ROOT:-}"
if [ -n "$DRY_ROOT" ]; then
  case "$DRY_ROOT" in
    /home/ghost/tmp/*) : ;;
    *) printf 'REPOINT_DRY_APPLY_ROOT must be under /home/ghost/tmp/ — got %s\n' "$DRY_ROOT" >&2; exit 6 ;;
  esac
  REPO="$DRY_ROOT"
  SSH_CONFIG="${DRY_ROOT}/targets/ssh_config"
  ENV_LOCAL="${DRY_ROOT}/targets/.env.local"
  MIDDLEWARE="${DRY_ROOT}/targets/middleware.ts"
  TAILSYNC="${DRY_ROOT}/targets/trevor-tailsync.sh"
  SENTINEL="${DRY_ROOT}/.repoint-authorized"
  BACKUP_DIR="${DRY_ROOT}/backups"
fi

# ── OLD (VM, trevor-prime-2) ──────────────────────────────────────────────────
OLD_TAILNET="100.95.174.30"
OLD_EXTERNAL="34.122.2.61"
OLD_USER="ghost"
OLD_KEY="~/.ssh/google_compute_engine"
# ── NEW (CONTAINER, trevor-prime-3 on ghostbox) ───────────────────────────────
NEW_TAILNET="100.89.253.42"
NEW_USER="trevor"
NEW_KEY="~/.ssh/ghostbox"
NEW_HOSTNAME="trevor-prime-3"

MODE="dry-run"
for a in "$@"; do
  case "$a" in
    --dry-run) MODE="dry-run" ;;
    --dry-apply) MODE="dry-apply" ;;
    --apply) MODE="apply" ;;
    --rollback) MODE="rollback" ;;
    --assert) MODE="assert" ;;
    *) echo "unknown argument: $a" >&2; exit 2 ;;
  esac
done

c_red=$'\033[31m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
say() { printf '%s\n' "$*"; }
hdr() { printf '\n%s══ %s %s\n' "$c_yel" "$*" "$c_off"; }

# ── THE 30 ROWS ───────────────────────────────────────────────────────────────
# id|class|file|what|current-probe|target
# class: SILENT | LOUD | DEGRADED | INERT   (re-derived live by C4 — see the note
# at the bottom: A7's headline 9/8/5/6 sums to 28, not 30, and undercounts SILENT.)
rows() {
cat <<'ROWS'
1|LOUD|ssh_config|Host vm -> HostName|HostName in the `vm` stanza|NEW_TAILNET
2|LOUD|ssh_config|Host vm -> User|User in the `vm` stanza|NEW_USER
3|LOUD|ssh_config|Host vm -> IdentityFile|IdentityFile in the `vm` stanza|NEW_KEY
4|INERT|ssh_config|Host vm alias list|`Host vm trevor-prime-2`|drop the trevor-prime-2 alias
5|INERT|ssh_config|Host trevor-prime-old stanza|stanza present (offline 46d)|delete the stanza
6|LOUD|env_local|VM_GATEWAY_IP|VM_GATEWAY_IP=|NEW_TAILNET
7|SILENT|env_local|HUB_VM_IP|HUB_VM_IP=|NEW_TAILNET
8|SILENT|middleware|HUB_VM_IP hardcoded fallback|literal 34.122.2.61 in middleware.ts|delete the constant + fallback + stale comment (COUPLED with #23) -> count 0
9|LOUD|env_local|VM_GATEWAY_PORT|VM_GATEWAY_PORT=|3940 (unchanged — container binds the same port)
10|DEGRADED|env_local|TREVOR_DB_PATH|TREVOR_DB_PATH=|UNCHANGED (WSL-local) — its FILLER moves, rows 17-19
11|DEGRADED|env_local|TREVOR_LOG_PATH|TREVOR_LOG_PATH=|UNCHANGED (WSL-local)
12|SILENT|env_local|trainer_loop._EXECUTOR_URL|TRAINER_EXECUTOR_URL=|http://NEW_TAILNET:3941
13|SILENT|env_local|trainer_loop._VM_HOST|TRAINER_VM_HOST=|vm (alias repointed by row 1)
14|SILENT|env_local|trainer_loop._VM_DIR/_VM_PY|TRAINER_VM_DIR=/TRAINER_VM_PY=|/home/trevor/trevor + venv/bin/python3 (same inside the container)
15|SILENT|env_local|watcher_health._vm_python|WATCHER_VM_HOST=|vm (alias repointed by row 1)
16|SILENT|env_local|watcher_review level read|WATCHER_REVIEW_VM_HOST=|vm (DISTINCT env name — a script setting only WATCHER_VM_HOST misses it)
29|SILENT|env_local|watcher_surface.py|WATCHER_VM_HOST=|vm (shares row 15's env name)
30|SILENT|env_local|watcher_integrity.py|WATCHER_INTEGRITY_VM_HOST=|vm (DISTINCT env name — the A7 s2.8 add)
17|LOUD|tailsync|trevor-tailsync.sh SSH_HOST|SSH_HOST="vm" literal|vm (alias repointed by row 1) — literal stays, NOT env-overridable
18|LOUD|tailsync|trevor-tailsync.sh VM_DB|VM_DB= literal|/home/trevor/trevor/trevor.db (same path inside the container)
19|LOUD|tailsync|VM-side sudo -u trevor + sqlite3|`sudo -n -u trevor` in the remote commands|DROP the wrapper — we log in AS trevor (Ghost approved)
20|LOUD|env_local|external_liveness_check.py|LIVENESS_VM_HOST=|vm (alias repointed by row 1)
21|SILENT|env_local|watcher_arm_check.py|VM refs via the `vm` alias|vm (alias repointed by row 1)
22|DEGRADED|code|Observatory URL x5|trevor-prime-2.tail2bf7a3.ts.net:8443|already dead (measured 000) — retarget or leave; not load-bearing
23|SILENT|middleware|trevor-prime.com 301|literal "trevor-prime.com" in middleware.ts|drop the redirect + stale comment (COUPLED with #8) -> count 0
24|INERT|-|/home/trevor/trevor shim|root-owned dir + symlink -> the replica|KEEP — makes ~424 hardcoded paths resolve WSL-locally
25|INERT|-|deploy/nginx/trevor-hub.conf|file present|no action (no nginx on either box)
26|INERT|-|two (+https://trevor-prime.com) User-Agents|literal in 2 files|no action
27|INERT|-|trevor-restore.sh + its unit|unit disabled|no action (superseded by tailsync)
28|INERT|-|~/.ssh/trevor_prime_2{,.pub}|orphan keypair|no action (referenced by no config block)
ROWS
}

# ── current-value probes, so the dry run shows REAL before/after ──────────────
probe() {
  case "$1" in
    1) awk '/^Host vm /{f=1} f&&/HostName/{print $2; exit}' "$SSH_CONFIG" 2>/dev/null ;;
    2) awk '/^Host vm /{f=1} f&&/User /{print $2; exit}' "$SSH_CONFIG" 2>/dev/null ;;
    3) awk '/^Host vm /{f=1} f&&/IdentityFile/{print $2; exit}' "$SSH_CONFIG" 2>/dev/null ;;
    4) grep -E '^Host vm' "$SSH_CONFIG" 2>/dev/null | head -1 ;;
    5) grep -cE '^Host trevor-prime-old' "$SSH_CONFIG" 2>/dev/null ;;
    6) grep -E '^VM_GATEWAY_IP=' "$ENV_LOCAL" 2>/dev/null | cut -d= -f2 ;;
    7) grep -E '^HUB_VM_IP=' "$ENV_LOCAL" 2>/dev/null | cut -d= -f2 ;;
    8) grep -c "$OLD_EXTERNAL" "$MIDDLEWARE" 2>/dev/null ;;
    9) grep -E '^VM_GATEWAY_PORT=' "$ENV_LOCAL" 2>/dev/null | cut -d= -f2 ;;
    10) grep -E '^TREVOR_DB_PATH=' "$ENV_LOCAL" 2>/dev/null | cut -d= -f2 ;;
    11) grep -E '^TREVOR_LOG_PATH=' "$ENV_LOCAL" 2>/dev/null | cut -d= -f2 ;;
    12) grep -E '^TRAINER_EXECUTOR_URL=' "$ENV_LOCAL" 2>/dev/null | cut -d= -f2 || echo "<unset — code default http://${OLD_TAILNET}:3941>" ;;
    13) grep -E '^TRAINER_VM_HOST=' "$ENV_LOCAL" 2>/dev/null | cut -d= -f2 || echo '<unset — code default "vm">' ;;
    14) grep -E '^TRAINER_VM_DIR=' "$ENV_LOCAL" 2>/dev/null | cut -d= -f2 || echo '<unset — code default /home/trevor/trevor>' ;;
    15|29) grep -E '^WATCHER_VM_HOST=' "$ENV_LOCAL" 2>/dev/null | cut -d= -f2 || echo '<unset — code default "vm">' ;;
    16) grep -E '^WATCHER_REVIEW_VM_HOST=' "$ENV_LOCAL" 2>/dev/null | cut -d= -f2 || echo '<unset — code default "vm">' ;;
    30) grep -E '^WATCHER_INTEGRITY_VM_HOST=' "$ENV_LOCAL" 2>/dev/null | cut -d= -f2 || echo '<unset — code default "vm">' ;;
    17) grep -E '^SSH_HOST=' "$TAILSYNC" 2>/dev/null | head -1 | cut -d'"' -f2 ;;
    18) grep -E '^VM_DB=' "$TAILSYNC" 2>/dev/null | head -1 | cut -d'"' -f2 ;;
    19) grep -c 'sudo -n -u trevor\|sudo -u trevor' "$TAILSYNC" 2>/dev/null ;;
    20) grep -E '^LIVENESS_VM_HOST=' "$ENV_LOCAL" 2>/dev/null | cut -d= -f2 || echo '<unset — code default "vm">' ;;
    22) grep -rlc 'trevor-prime-2.tail2bf7a3' "${REPO}/src" 2>/dev/null | wc -l ;;
    23) grep -c 'trevor-prime\.com' "$MIDDLEWARE" 2>/dev/null ;;
    *) echo "-" ;;
  esac
}

expand() {
  sed -e "s/NEW_TAILNET/${NEW_TAILNET}/g" -e "s/NEW_USER/${NEW_USER}/g" \
      -e "s|NEW_KEY|${NEW_KEY}|g" <<<"$1"
}

# ── DRY RUN ───────────────────────────────────────────────────────────────────
do_dry_run() {
  hdr "DRY RUN — all 30 rows, before -> after. NOTHING IS WRITTEN."
  say "${c_dim}target: container ${NEW_HOSTNAME} @ ${NEW_TAILNET} (NOT ghostbox the host)${c_off}"
  printf '\n%-4s %-9s %-42s %-30s %s\n' "ROW" "CLASS" "WHAT" "CURRENT" "WOULD BECOME"
  printf '%s\n' "$(printf '─%.0s' {1..150})"
  local n_silent=0 n_loud=0 n_deg=0 n_inert=0
  while IFS='|' read -r id class file what curprobe target; do
    [ -z "${id:-}" ] && continue
    local cur; cur="$(probe "$id" 2>/dev/null | head -1)"; cur="${cur:-<absent>}"
    local tgt; tgt="$(expand "$target")"
    local colour="$c_off"
    case "$class" in
      SILENT) colour="$c_red"; n_silent=$((n_silent+1)) ;;
      LOUD) n_loud=$((n_loud+1)) ;;
      DEGRADED) n_deg=$((n_deg+1)) ;;
      INERT) colour="$c_dim"; n_inert=$((n_inert+1)) ;;
    esac
    printf '%s%-4s %-9s%s %-42s %-30s %s\n' "$colour" "#$id" "$class" "$c_off" \
      "${what:0:42}" "${cur:0:30}" "${tgt:0:60}"
  done < <(rows)
  printf '%s\n' "$(printf '─%.0s' {1..150})"
  say "totals: ${c_red}SILENT ${n_silent}${c_off} · LOUD ${n_loud} · DEGRADED ${n_deg} · INERT ${n_inert}  (= $((n_silent+n_loud+n_deg+n_inert)) rows)"
  say ""
  say "${c_red}🚨 THE ${n_silent} SILENT ROWS ARE THE DANGEROUS ONES.${c_off} A silent row that did not"
  say "   move produces NO error at all — the Hub simply keeps reading the old box."
  say "   Run --assert after the flip; every one of them has a post-flip assertion."
  say ""
  say "${c_yel}NOTE — A7's headline '9 SILENT · 8 LOUD · 5 DEGRADED-VISIBLE · 6 INERT' sums to 28,"
  say "not 30, and cannot be reconciled with A7 §11's own table. Re-derived live by C4"
  say "from the table's own symbols: SILENT ${n_silent}, not 9. The two §2.8 additions (#29, #30)"
  say "are both SILENT and are missing from the headline tally.${c_off}"
  say ""
  say "${c_grn}DRY RUN COMPLETE — 0 files opened for writing, 0 bytes changed.${c_off}"
}

# ── REFUSAL ───────────────────────────────────────────────────────────────────
check_authorisation() {
  local ok=1
  say ""
  say "${c_yel}AUTHORISATION CHECK — three independent gates, ALL required${c_off}"
  if [ "${REPOINT_AUTHORIZED:-}" = "WAVE-D" ]; then
    say "  ${c_grn}✓${c_off} gate 2: REPOINT_AUTHORIZED=WAVE-D"
  else
    say "  ${c_red}✗${c_off} gate 2: REPOINT_AUTHORIZED is not WAVE-D (got '${REPOINT_AUTHORIZED:-<unset>}')"; ok=0
  fi
  if [ -f "$SENTINEL" ] && [ "$(tr -d '[:space:]' < "$SENTINEL" 2>/dev/null)" = "WAVE-D" ]; then
    say "  ${c_grn}✓${c_off} gate 3: sentinel ${SENTINEL} present and reads WAVE-D"
  else
    say "  ${c_red}✗${c_off} gate 3: sentinel ${SENTINEL} absent or wrong contents"; ok=0
  fi
  say "  ${c_grn}✓${c_off} gate 1: --apply was passed"
  if [ "$ok" -ne 1 ]; then
    say ""
    say "${c_red}🚨 REFUSED. The repoint was NOT applied and no file was opened for writing.${c_off}"
    say "   This is the guard working. The Hub keeps reading the VM."
    say "   Wave D, with Ghost's explicit approval, runs:"
    say "     printf 'WAVE-D' > ${SENTINEL}"
    say "     REPOINT_AUTHORIZED=WAVE-D $0 --apply"
    return 3
  fi
  return 0
}

# ── APPLY / ROLLBACK ──────────────────────────────────────────────────────────
do_apply() {
  check_authorisation || exit 3

  # 🚨 MANDATORY PRE-FLIGHT — the dry-apply is a GATE, not a suggestion.
  #   Wave D must not be able to fire this without an outcome-checked rehearsal, because
  #   a dry RUN could not have caught either blocking defect. Making it advisory and
  #   writing "please run --dry-apply first" in a doc is exactly how R3 would rot.
  #   It is also what restores ATOMICITY: the middleware/tailsync steps below refuse
  #   loudly (exit 5) rather than write a wrong file, and a refusal AFTER the ssh and
  #   env rows have moved would leave a partial repoint — the one state this script
  #   exists to prevent. The pre-flight drives every one of those refusals on copies
  #   first, so by the time a byte is written here, all of them are known to pass.
  if [ -z "$DRY_ROOT" ]; then
    if ! do_dry_apply; then
      say ""
      say "${c_red}🚨 REFUSED — the pre-flight dry-apply found a row that does not produce its"
      say "   intended outcome. NOTHING WAS WRITTEN. Fix the script, not this gate.${c_off}"
      exit 7
    fi
    say ""
    say "${c_grn}pre-flight passed — proceeding to the real apply${c_off}"
  fi

  local stamp; stamp="$(date +%Y%m%dT%H%M%S)"
  local bdir="${BACKUP_DIR}/${stamp}"
  mkdir -p "$bdir" || { say "${c_red}cannot create backup dir — refusing${c_off}"; exit 4; }
  for f in "$SSH_CONFIG" "$ENV_LOCAL" "$MIDDLEWARE" "$TAILSYNC"; do
    cp -p "$f" "${bdir}/$(basename "$f")" || { say "${c_red}backup of $f failed — refusing to proceed${c_off}"; exit 4; }
  done
  printf '%s\n' "$SSH_CONFIG" "$ENV_LOCAL" "$MIDDLEWARE" "$TAILSYNC" > "${bdir}/MANIFEST"
  ln -sfn "$bdir" "${BACKUP_DIR}/latest"
  say "${c_grn}backups written to ${bdir} (rollback: $0 --rollback)${c_off}"

  # --- the pipe (rows 1-5) ---
  sed -i -E "s|^(\s*HostName\s+)${OLD_TAILNET}\s*$|\1${NEW_TAILNET}|" "$SSH_CONFIG"
  sed -i -E "/^Host vm/,/^$/ s|^(\s*User\s+)${OLD_USER}\s*$|\1${NEW_USER}|" "$SSH_CONFIG"
  sed -i -E "/^Host vm/,/^$/ s|^(\s*IdentityFile\s+).*$|\1${NEW_KEY}|" "$SSH_CONFIG"
  sed -i -E "s|^Host vm trevor-prime-2\s*$|Host vm|" "$SSH_CONFIG"
  python3 - "$SSH_CONFIG" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
s = re.sub(r'(?ms)^Host trevor-prime-old\b.*?(?=^Host |\Z)', '', s)
open(p, 'w').write(s)
PY

  # --- env (rows 6-16, 20, 21, 29, 30) ---
  set_env() {  # key value
    if grep -qE "^$1=" "$ENV_LOCAL"; then
      sed -i -E "s|^$1=.*$|$1=$2|" "$ENV_LOCAL"
    else
      printf '%s=%s\n' "$1" "$2" >> "$ENV_LOCAL"
    fi
  }
  set_env VM_GATEWAY_IP "$NEW_TAILNET"
  set_env HUB_VM_IP "$NEW_TAILNET"
  set_env TRAINER_EXECUTOR_URL "http://${NEW_TAILNET}:3941"
  set_env TRAINER_VM_HOST vm
  set_env TRAINER_VM_DIR /home/trevor/trevor
  set_env TRAINER_VM_PY venv/bin/python3
  set_env WATCHER_VM_HOST vm
  set_env WATCHER_REVIEW_VM_HOST vm
  set_env WATCHER_INTEGRITY_VM_HOST vm
  set_env LIVENESS_VM_HOST vm

  # --- middleware (rows 8, 23) ---
  # 🚨 THE SED THAT USED TO LIVE HERE DESTROYED THIS FILE (A5 F-1 / master B-26).
  #   Recorded verbatim so it is never reintroduced:
  #     sed -i -E "s|process\.env\.HUB_VM_IP \|\| \"${OLD_EXTERNAL}\"|process.env.HUB_VM_IP|"
  #   With `|` as the s-delimiter, sed treats `\|` as an ESCAPED DELIMITER and strips the
  #   backslash, emitting a BARE `|` into the regex. Under -E that is ERE alternation, so
  #   the compiled pattern was `X || Y` — three branches whose MIDDLE ONE IS EMPTY. An
  #   empty branch matches zero-length at offset 0 of EVERY line, and `s` without /g takes
  #   that leftmost match, so the replacement was prepended to all 204 lines and row 8
  #   never moved. Proven with `sed --debug`: program `s/X || Y/R/`, match register
  #   `regex[0] = 0-0 ''`. Swapping the delimiter fixes it because `\|` then stops being a
  #   delimiter escape and the backslash survives into the regex as a literal pipe.
  #
  # 🚨 ROWS 8 AND 23 ARE COUPLED AND MUST MOVE TOGETHER.
  #   Row 23 removes the direct-IP 301, which holds the ONLY consumer of row 8's constant
  #   (`host.startsWith(HUB_VM_IP)`). Removing the fallback alone leaves
  #   `const HUB_VM_IP = process.env.HUB_VM_IP` typed `string | undefined`, which fails
  #   `tsc --strict` with TS2345 — proven with a positive control. A repoint that swaps a
  #   corrupted file for one that cannot build is not an improvement. This is therefore
  #   ONE structural edit, done in python for the same reason the `Host trevor-prime-old`
  #   stanza removal above is.
  #
  # 🚨 THE STALE COMMENTS GO TOO, AND THAT IS LOAD-BEARING, NOT TIDYING.
  #   Assertions #8 and #23 are `grep -c` over the whole file, so a dead literal surviving
  #   in a COMMENT fails them just as surely as one in code. Before this fix the literals
  #   appeared 2x each — once in code, once in prose — so even a perfect code-only edit
  #   left the assertions failing permanently. Rewriting the prose is what makes the
  #   count-based assertions honest as written.
  #
  # 🚨 EVERY SUBSTITUTION ASSERTS IT FIRED. A sed that matches nothing exits 0, and that
  #   silence is precisely what carried both defects to the edge of Wave D.
  python3 - "$MIDDLEWARE" <<'PY'
import re, sys

path = sys.argv[1]
src = open(path, encoding="utf-8").read()

# (label, compiled pattern, replacement, expected number of substitutions)
EDITS = [
    (
        "rows 8+23: drop the HUB_VM_IP constant, its fallback and its provenance comment",
        re.compile(
            r"^// QUAL-06 \(2026-06-03\): externalized the VM IP.*?"
            r'^const HUB_VM_IP = process\.env\.HUB_VM_IP \|\| "34\.122\.2\.61";\n',
            re.M | re.S,
        ),
        "// RM-REPAIR [B9] (2026-08-11) — repoint rows #8 + #23, applied together.\n"
        "// The direct-IP -> domain 301 was REMOVED, and with it the HUB_VM_IP constant\n"
        "// and its hardcoded fallback. It redirected to the retired public domain, whose\n"
        "// A record still points at the TERMINATED 34.28.231.36 and which no box serves,\n"
        "// so it sent every direct-IP visitor to a timeout.\n"
        "// The two rows are COUPLED: #23 deletes the only consumer of #8's constant, so\n"
        "// removing the fallback alone leaves a `string | undefined` that fails\n"
        "// `tsc --strict` (TS2345). Do not restore either half independently.\n",
        1,
    ),
    (
        "row 23: drop the direct-IP redirect block and its now-unused `host` local",
        re.compile(
            r"^  // Redirect direct IP access to domain\n"
            r'^  const host = request\.headers\.get\("host"\) \|\| "";\n'
            r"^  if \(host\.startsWith\(HUB_VM_IP\)\) \{\n"
            r"(?:^.*\n)*?"
            r"^  \}\n\n",
            re.M,
        ),
        "",
        1,
    ),
    (
        "row 23: the surviving prose still named the retired domain",
        re.compile(
            r"^  // \(they carry recon/cost data that must not be public on trevor-prime\.com\)\.$",
            re.M,
        ),
        "  // (they carry recon/cost data that must not be publicly reachable).",
        1,
    ),
]

for label, pattern, repl, want in EDITS:
    src, n = pattern.subn(repl, src, count=want)
    if n != want:
        sys.stderr.write(
            "MIDDLEWARE EDIT FAILED: %s -- expected %d substitution(s), made %d.\n"
            "The file was NOT written. Restore with --rollback if anything else already ran.\n"
            % (label, want, n)
        )
        raise SystemExit(1)

# Post-conditions: exactly what assertions #8 and #23 will measure.
for needle, row in (("34.122.2.61", 8), ("trevor-prime.com", 23)):
    hits = src.count(needle)
    if hits:
        sys.stderr.write(
            "MIDDLEWARE POST-CONDITION FAILED: %r still appears %d time(s); "
            "assertion #%d requires 0. The file was NOT written.\n" % (needle, hits, row)
        )
        raise SystemExit(1)

open(path, "w", encoding="utf-8").write(src)
print("  middleware: rows 8 + 23 applied; both dead literals now count 0")
PY
  if [ $? -ne 0 ]; then
    say "${c_red}🚨 middleware edit REFUSED (see stderr above). Nothing was written to it.${c_off}"
    say "${c_red}   Other targets HAVE been modified — run: $0 --rollback${c_off}"
    exit 5
  fi

  # --- tailsync (rows 17-19) ---
  # Row 19: we now log in AS trevor, so the sudo wrapper goes. See the header note.
  sed -i -E 's|sudo -n -u trevor ||g; s|sudo -u trevor ||g' "$TAILSYNC"
  # 🚨 Row 19's probe is `grep -c` (LINES, not occurrences) and the two comment lines below
  #   carry `sudo -u trevor` inside BACKTICKS with no trailing space, so the substitution
  #   above cannot reach them (it requires the trailing space). Left alone they would
  #   survive the flip describing behaviour the script no longer has — drift minted by the
  #   repoint itself (A5 F-11 / R13). Rewritten, not deleted: the ownership fact they
  #   record is still true, only its cause changed.
  python3 - "$TAILSYNC" <<'PY'
import re, sys

path = sys.argv[1]
src = open(path, encoding="utf-8").read()

pattern = re.compile(
    r"^# Snapshot is created by `sudo -u trevor`, so it is owned by trevor; /tmp's sticky bit means\n"
    r"^# only trevor can remove it\. All VM-snapshot removals therefore run as `sudo -u trevor`\.$",
    re.M,
)
repl = (
    "# Snapshot is created by the login user `trevor`, so it is owned by trevor; /tmp's sticky\n"
    "# bit means only trevor can remove it. VM-snapshot removals therefore run as that same\n"
    "# login user -- the per-command sudo wrapper the VM pipe needed is gone (repoint row 19)."
)
src, n = pattern.subn(repl, src, count=1)
if n != 1:
    sys.stderr.write(
        "TAILSYNC COMMENT EDIT FAILED: expected 1 substitution, made %d. Not written.\n" % n
    )
    raise SystemExit(1)

stale = len(re.findall(r"sudo -n -u trevor|sudo -u trevor", src))
if stale:
    sys.stderr.write(
        "TAILSYNC POST-CONDITION FAILED: %d line(s)/occurrence(s) still name the sudo "
        "wrapper; row 19's probe requires 0. Not written.\n" % stale
    )
    raise SystemExit(1)

open(path, "w", encoding="utf-8").write(src)
print("  tailsync: row 19 applied; 0 sudo-wrapper references remain")
PY
  if [ $? -ne 0 ]; then
    say "${c_red}🚨 tailsync comment edit REFUSED (see stderr above).${c_off}"
    say "${c_red}   Other targets HAVE been modified — run: $0 --rollback${c_off}"
    exit 5
  fi

  say "${c_grn}APPLIED. Now run: $0 --assert${c_off}"
  say "${c_yel}🚨 Restart trevor-dashboard AND trevor-gateway — .env.local feeds both.${c_off}"
}

# ── OUTCOME VERIFICATION — what each row ACTUALLY produced ────────────────────
# 🚨 THIS IS THE THING THE DRY RUN COULD NOT DO. `--dry-run` prints INTENTIONS: it
#   reads the current value and prints the target string beside it. It never applies
#   anything, so it cannot tell you that row 8's sed destroys the file and moves
#   nothing. Both blocking defects (A5 F-1, F-2 / master B-26, B-27) were invisible
#   to it for exactly that reason. This function reads OUTCOMES off a real apply.
# Args: $1 = root whose targets/ holds the APPLIED files. Sets v_pass / v_fail.
verify_rows() {
  local r="$1"
  local S="${r}/targets/ssh_config" E="${r}/targets/.env.local"
  local M="${r}/targets/middleware.ts" T="${r}/targets/trevor-tailsync.sh"
  local P="${r}/pristine"
  v_pass=0; v_fail=0
  _y() { printf '  %s✅ #%-3s %-9s %s%s\n' "$c_grn" "$1" "$2" "$3" "$c_off"; v_pass=$((v_pass+1)); }
  _n() { printf '  %s❌ #%-3s %-9s %s%s\n' "$c_red" "$1" "$2" "$3" "$c_off"; v_fail=$((v_fail+1)); }
  _i() { printf '  %s·  #%-3s %-9s %s%s\n' "$c_dim" "$1" "$2" "$3" "$c_off"; }
  _sshv() { awk '/^Host vm/{f=1} f&&$1=="'"$2"'"{print $2; exit}' "$1"; }
  _env()  { grep -E "^$1=" "$E" 2>/dev/null | cut -d= -f2- ; }
  _lit()  { grep -E "^$1=" "$T" 2>/dev/null | head -1 | awk -F'"' '{print $2}' ; }
  _eq()   { [ "$2" = "$3" ] && _y "$1" MOVED "$4" || _n "$1" WRONG "$4 — got '${2:-<absent>}', wanted '$3'"; }

  _eq 1 "$(_sshv "$S" HostName)"     "$NEW_TAILNET" "ssh HostName"
  _eq 2 "$(_sshv "$S" User)"         "$NEW_USER"    "ssh User"
  _eq 3 "$(_sshv "$S" IdentityFile)" "$NEW_KEY"     "ssh IdentityFile"
  grep -qE '^Host vm$' "$S" && _y 4 MOVED "trevor-prime-2 alias dropped" \
                            || _n 4 WRONG "alias line is still '$(grep -E '^Host vm' "$S")'"
  [ "$(grep -cE '^Host trevor-prime-old' "$S")" = 0 ] && _y 5 MOVED "trevor-prime-old stanza gone" \
                            || _n 5 WRONG "trevor-prime-old stanza survives"
  _eq 6  "$(_env VM_GATEWAY_IP)"            "$NEW_TAILNET"                   "VM_GATEWAY_IP"
  _eq 7  "$(_env HUB_VM_IP)"                "$NEW_TAILNET"                   "HUB_VM_IP"
  # 🚨 #8 and #23 are measured with the SAME probe the assertions use, over the WHOLE
  #   file — a dead literal surviving in a comment fails them exactly as a live one does.
  [ "$(grep -c "$OLD_EXTERNAL" "$M")" = 0 ] && _y 8 MOVED "middleware: 0x ${OLD_EXTERNAL} (assertion #8 wants 0)" \
       || _n 8 WRONG "middleware still carries ${OLD_EXTERNAL} $(grep -c "$OLD_EXTERNAL" "$M")x — assertion #8 will FAIL"
  _eq 9  "$(_env VM_GATEWAY_PORT)"          "3940"                           "VM_GATEWAY_PORT (unchanged by intent)"
  # 🚨 #10's VALUE never changes — what changes is what FILLS it (rows 17-19). Verifying
  #   it as 'unchanged' is the point: a #10 that MOVED would mean someone repointed the
  #   Hub's read path off the WSL-local replica, which is not what this repoint does.
  cmp -s <(grep '^TREVOR_DB_PATH='  "$P/.env.local") <(grep '^TREVOR_DB_PATH='  "$E") \
       && _y 10 UNCHANGED "TREVOR_DB_PATH — value never moves; its FILLER moves (17-19)" \
       || _n 10 WRONG     "TREVOR_DB_PATH CHANGED — the read path must stay WSL-local"
  cmp -s <(grep '^TREVOR_LOG_PATH=' "$P/.env.local") <(grep '^TREVOR_LOG_PATH=' "$E") \
       && _y 11 UNCHANGED "TREVOR_LOG_PATH — WSL-local" || _n 11 WRONG "TREVOR_LOG_PATH CHANGED"
  _eq 12 "$(_env TRAINER_EXECUTOR_URL)"     "http://${NEW_TAILNET}:3941"     "TRAINER_EXECUTOR_URL"
  _eq 13 "$(_env TRAINER_VM_HOST)"          "vm"                             "TRAINER_VM_HOST"
  _eq 14 "$(_env TRAINER_VM_DIR)"           "/home/trevor/trevor"            "TRAINER_VM_DIR"
  _eq 15 "$(_env WATCHER_VM_HOST)"          "vm"                             "WATCHER_VM_HOST"
  _eq 16 "$(_env WATCHER_REVIEW_VM_HOST)"   "vm"                             "WATCHER_REVIEW_VM_HOST (DISTINCT name)"
  _eq 17 "$(_lit SSH_HOST)"                 "vm"                             "tailsync SSH_HOST — literal stays, alias moved by #1"
  _eq 18 "$(_lit VM_DB)"                    "/home/trevor/trevor/trevor.db"  "tailsync VM_DB (same path in the container)"
  [ "$(grep -c 'sudo -n -u trevor\|sudo -u trevor' "$T")" = 0 ] \
       && _y 19 MOVED "tailsync: 0 sudo-wrapper lines (code AND comments)" \
       || _n 19 WRONG "tailsync still names the sudo wrapper on $(grep -c 'sudo -n -u trevor\|sudo -u trevor' "$T") line(s)"
  _eq 20 "$(_env LIVENESS_VM_HOST)"         "vm"                             "LIVENESS_VM_HOST"
  _i  21 ALIAS     "watcher_arm_check — rides the \`vm\` alias moved by #1; no file in scope"
  _i  22 NO-ACTION "Observatory :8443 x5 — DEGRADED, dead host, manifest says leave"
  [ "$(grep -c 'trevor-prime\.com' "$M")" = 0 ] && _y 23 MOVED "middleware: 0x trevor-prime.com (assertion #23 wants 0)" \
       || _n 23 WRONG "trevor-prime.com survives $(grep -c 'trevor-prime\.com' "$M")x — assertion #23 will FAIL"
  for i in 24 25 26 27 28; do _i "$i" NO-ACTION "INERT — outside the 4 target files by manifest"; done
  _eq 29 "$(_env WATCHER_VM_HOST)"          "vm"                             "watcher_surface (shares #15's name)"
  _eq 30 "$(_env WATCHER_INTEGRITY_VM_HOST)" "vm"                            "watcher_integrity (the §2.8 add)"
}

# ── DRY-APPLY — the pre-apply gate. A5's R3, and its highest-value item. ──────
# Copies the four targets to scratch, runs the REAL apply against the copies, and
# diffs the OUTCOME against intent, row by row. Touches nothing live, and proves it
# by sha256 before and after.
do_dry_apply() {
  [ -n "$DRY_ROOT" ] && { say "${c_red}refusing to nest --dry-apply${c_off}"; exit 6; }
  local root; root="/home/ghost/tmp/repoint-dry-apply.$$"
  hdr "DRY-APPLY — real apply on isolated copies, then diff OUTCOME vs intent"
  say "${c_dim}scratch: ${root} (removed on exit; /home, never /tmp)${c_off}"
  local live=("$SSH_CONFIG" "$ENV_LOCAL" "$MIDDLEWARE" "$TAILSYNC")
  local before after
  before="$(sha256sum "${live[@]}" 2>/dev/null)"

  rm -rf "$root"; mkdir -p "$root/targets" "$root/backups" || { say "${c_red}cannot create scratch${c_off}"; exit 4; }
  # shellcheck disable=SC2064
  trap "rm -rf '$root'" EXIT
  cp -p "$SSH_CONFIG" "$root/targets/ssh_config"
  cp -p "$ENV_LOCAL"  "$root/targets/.env.local"
  cp -p "$MIDDLEWARE" "$root/targets/middleware.ts"
  cp -p "$TAILSYNC"   "$root/targets/trevor-tailsync.sh"
  cp -rp "$root/targets" "$root/pristine"
  printf 'WAVE-D' > "$root/.repoint-authorized"

  say ""
  say "── running the REAL apply path against the copies ──"
  local rc=0
  REPOINT_DRY_APPLY_ROOT="$root" REPOINT_AUTHORIZED=WAVE-D bash "$0" --apply 2>&1 \
    | sed 's/^/  /' || true
  rc="${PIPESTATUS[0]}"

  say ""
  say "── OUTCOME vs INTENT, all 30 rows ──"
  local v_pass=0 v_fail=0
  if [ "$rc" -ne 0 ]; then
    say "  ${c_red}the apply itself exited ${rc} — rows below reflect a PARTIAL apply${c_off}"
  fi
  verify_rows "$root"

  # 🚨 The whole point is safety, so prove it rather than assert it.
  after="$(sha256sum "${live[@]}" 2>/dev/null)"
  say ""
  if [ "$before" = "$after" ]; then
    say "  ${c_grn}✅ ZERO LIVE WRITES — all 4 targets sha256-identical before and after${c_off}"
  else
    say "  ${c_red}🚨 A LIVE FILE CHANGED DURING --dry-apply. This is a defect in the dry-apply"
    say "     itself. Investigate before running anything else.${c_off}"
    diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") | sed 's/^/     /'
    v_fail=$((v_fail+1))
  fi

  printf '\n%s\n' "$(printf '─%.0s' {1..70})"
  say "DRY-APPLY: ${c_grn}${v_pass} rows produced their intended outcome${c_off} · ${c_red}${v_fail} did not${c_off} · 7 no-action"
  trap - EXIT; rm -rf "$root"
  if [ "$v_fail" -eq 0 ] && [ "$rc" -eq 0 ]; then
    say "${c_grn}SAFE TO APPLY — every row was driven for real and checked by outcome.${c_off}"
    return 0
  fi
  say "${c_red}🚨 DO NOT APPLY. A row did not produce its intended outcome.${c_off}"
  return 1
}

do_rollback() {
  local bdir="${BACKUP_DIR}/latest"
  [ -d "$bdir" ] || { say "${c_red}no backup at ${bdir} — nothing to roll back${c_off}"; exit 4; }
  while read -r f; do
    cp -p "${bdir}/$(basename "$f")" "$f" && say "restored $f"
  done < "${bdir}/MANIFEST"
  say "${c_grn}ROLLED BACK from ${bdir}. Restart trevor-dashboard and trevor-gateway.${c_off}"
}

case "$MODE" in
  dry-run) do_dry_run ;;
  dry-apply) do_dry_apply ;;
  apply) do_apply ;;
  rollback) do_rollback ;;
  assert) exec "${REPO}/deploy/scripts/wave_d_repoint_assert.sh" ;;
esac
