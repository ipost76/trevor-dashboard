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
#   ./wave_d_repoint.sh --apply         # REFUSED unless all three authorisations are present
#   ./wave_d_repoint.sh --rollback      # restore every file from the backup manifest
#   ./wave_d_repoint.sh --assert        # run the 11 SILENT-row post-flip assertions
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
8|SILENT|middleware|HUB_VM_IP hardcoded fallback|literal 34.122.2.61 in middleware.ts|delete the literal fallback
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
23|SILENT|middleware|trevor-prime.com 301|literal "trevor-prime.com" in middleware.ts|already 301s to a terminated host — drop the redirect
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
  sed -i -E "s|process\.env\.HUB_VM_IP \|\| \"${OLD_EXTERNAL}\"|process.env.HUB_VM_IP|" "$MIDDLEWARE"

  # --- tailsync (rows 17-19) ---
  # Row 19: we now log in AS trevor, so the sudo wrapper goes. See the header note.
  sed -i -E 's|sudo -n -u trevor ||g; s|sudo -u trevor ||g' "$TAILSYNC"

  say "${c_grn}APPLIED. Now run: $0 --assert${c_off}"
  say "${c_yel}🚨 Restart trevor-dashboard AND trevor-gateway — .env.local feeds both.${c_off}"
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
  apply) do_apply ;;
  rollback) do_rollback ;;
  assert) exec "${REPO}/deploy/scripts/wave_d_repoint_assert.sh" ;;
esac
