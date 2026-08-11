#!/usr/bin/env bash
# =============================================================================
# wave_d_repoint_assert.sh — POST-FLIP ASSERTIONS FOR THE SILENT ROWS.
# Staged by C4 so Wave D has them ready. Run immediately after --apply.
#
# 🚨 WHY ONLY THE SILENT ROWS GET THIS TREATMENT.
#   A LOUD row that fails to move announces itself: `ssh vm` errors, tailsync exits
#   non-zero under `set -euo pipefail`, the gateway 502s. **A SILENT row that did
#   not move produces NO error at all** — the Hub simply carries on reading the old
#   box, and every dashboard stays green. That is precisely why they are the
#   dangerous ones, and why each needs an assertion written in advance rather than
#   improvised at cutover.
#
# 🚨 THE COUNT IS 11, NOT 9.
#   A7 §3.5's headline reads "9 SILENT · 8 LOUD · 5 DEGRADED-VISIBLE · 6 INERT",
#   which sums to 28 against a 30-row manifest and does not reconcile with A7 §11's
#   own symbols. C4 re-derived it live from the table: the two §2.8 additions
#   (#29 watcher_surface, #30 watcher_integrity) are BOTH silent and are absent from
#   the headline tally. **Eleven rows, eleven assertions.** Writing nine would have
#   left the two newest silent rows unasserted — the exact gap §2.8 was raised to close.
#
# 🚨 THE DISCRIMINATOR IS THE FAR SIDE'S HOSTNAME, NOT A CONFIG STRING.
#   Asserting that a config file now contains the new IP proves only that sed ran.
#   A silent row that did not move still REACHES trevor-prime-2 and still returns
#   valid data. So wherever a real round trip is possible, these assert that the far
#   side identifies itself as `trevor-prime-3`. A config-only check is marked as such.
#
# EXIT: 0 all pass · 1 any failure
# =============================================================================
set -uo pipefail

REPO="/home/ghost/projects/trevor-dashboard"
ENV_LOCAL="${REPO}/.env.local"
MIDDLEWARE="${REPO}/src/middleware.ts"
NEW_TAILNET="100.89.253.42"
NEW_HOSTNAME="trevor-prime-3"
OLD_TAILNET="100.95.174.30"
OLD_EXTERNAL="34.122.2.61"
OLD_HOSTNAME="trevor-prime-2"

pass=0; fail=0
c_red=$'\033[31m'; c_grn=$'\033[32m'; c_off=$'\033[0m'
ok()  { printf '  %s✅ #%-3s %s%s\n' "$c_grn" "$1" "$2" "$c_off"; pass=$((pass+1)); }
no()  { printf '  %s❌ #%-3s %s — %s%s\n' "$c_red" "$1" "$2" "$3" "$c_off"; fail=$((fail+1)); }

# The far side's identity, fetched ONCE over the repointed pipe.
FAR_HOST="$(ssh -o BatchMode=yes -o ConnectTimeout=10 vm 'hostname' 2>/dev/null | tr -d '[:space:]')"
printf '\n══ POST-FLIP ASSERTIONS — the 11 SILENT rows ══\n'
printf '   far side of `ssh vm` identifies as: %s\n\n' "${FAR_HOST:-<unreachable>}"

# ── #7 HUB_VM_IP ─────────────────────────────────────────────────────────────
v="$(grep -E '^HUB_VM_IP=' "$ENV_LOCAL" 2>/dev/null | cut -d= -f2)"
[ "$v" = "$NEW_TAILNET" ] && ok 7 "HUB_VM_IP = ${NEW_TAILNET}" \
  || no 7 "HUB_VM_IP" "is '${v:-<absent>}', expected ${NEW_TAILNET} (config-only check)"

# ── #8 the hardcoded fallback ────────────────────────────────────────────────
# 🚨 Deleting the env var alone RESTORES the dead IP. Both halves must be gone.
n="$(grep -c "$OLD_EXTERNAL" "$MIDDLEWARE" 2>/dev/null || echo 0)"
[ "$n" = "0" ] && ok 8 "middleware.ts carries no ${OLD_EXTERNAL} fallback" \
  || no 8 "middleware fallback" "${OLD_EXTERNAL} still appears ${n}× — deleting HUB_VM_IP would resurrect the dead IP"

# ── #12 trainer_loop._EXECUTOR_URL — a REAL connect, not a string match ──────
u="$(grep -E '^TRAINER_EXECUTOR_URL=' "$ENV_LOCAL" 2>/dev/null | cut -d= -f2)"
if [ "$u" = "http://${NEW_TAILNET}:3941" ]; then
  if timeout 8 bash -c "</dev/tcp/${NEW_TAILNET}/3941" 2>/dev/null; then
    ok 12 "_EXECUTOR_URL points at ${NEW_TAILNET}:3941 AND the port accepts"
  else
    no 12 "_EXECUTOR_URL" "set correctly but ${NEW_TAILNET}:3941 does NOT accept — _post would return None, silently"
  fi
else
  no 12 "_EXECUTOR_URL" "is '${u:-<unset>}' — an unset value falls back to the OLD box in code"
fi

# ── #13 trainer_loop._VM_HOST — assert the far side, not the alias text ─────
[ "$FAR_HOST" = "$NEW_HOSTNAME" ] \
  && ok 13 "_VM_HOST 'vm' resolves to ${NEW_HOSTNAME}" \
  || no 13 "_VM_HOST" "\`ssh vm\` reached '${FAR_HOST:-<unreachable>}', not ${NEW_HOSTNAME}"

# ── #14 _VM_DIR / _VM_PY — the interpreter must EXIST on the far side ───────
if [ "$FAR_HOST" = "$NEW_HOSTNAME" ] && ssh -o BatchMode=yes vm 'test -x /home/trevor/trevor/venv/bin/python3' 2>/dev/null; then
  ok 14 "_VM_DIR/_VM_PY resolve to a real interpreter on ${NEW_HOSTNAME}"
else
  no 14 "_VM_DIR/_VM_PY" "venv/bin/python3 not executable at /home/trevor/trevor on the far side"
fi

# ── #15 watcher_health._vm_python — a REAL round trip returning ok:true ─────
r="$(cd "$REPO" && python3 -c "
import watcher_health as w, json
print(json.dumps(w._vm_python('import socket, json; print(json.dumps({\"ok\": True, \"host\": socket.gethostname()}))','{}',25)))
" 2>/dev/null)"
if grep -q "\"host\": \"${NEW_HOSTNAME}\"" <<<"$r" 2>/dev/null; then
  ok 15 "watcher_health._vm_python round-trips to ${NEW_HOSTNAME}"
else
  no 15 "watcher_health._vm_python" "RPC did not report ${NEW_HOSTNAME}: ${r:0:120}"
fi

# ── #16 watcher_review — DISTINCT env name, the classic miss ────────────────
v="$(grep -E '^WATCHER_REVIEW_VM_HOST=' "$ENV_LOCAL" 2>/dev/null | cut -d= -f2)"
if [ -n "$v" ] && [ "$FAR_HOST" = "$NEW_HOSTNAME" ]; then
  ok 16 "WATCHER_REVIEW_VM_HOST='${v}' -> ${NEW_HOSTNAME}"
else
  no 16 "watcher_review" "WATCHER_REVIEW_VM_HOST='${v:-<unset>}' — this is a DISTINCT env name; a script setting only WATCHER_VM_HOST misses it"
fi

# ── #21 watcher_arm_check ───────────────────────────────────────────────────
if [ "$FAR_HOST" = "$NEW_HOSTNAME" ] && [ -f "${REPO}/scripts/watcher_arm_check.py" ]; then
  ok 21 "watcher_arm_check's VM refs resolve to ${NEW_HOSTNAME} (on-demand path)"
else
  no 21 "watcher_arm_check" "far side is '${FAR_HOST:-<unreachable>}'"
fi

# ── #23 trevor-prime.com 301 ───────────────────────────────────────────────
n="$(grep -c 'trevor-prime\.com' "$MIDDLEWARE" 2>/dev/null || echo 0)"
[ "$n" = "0" ] && ok 23 "the trevor-prime.com 301 is gone" \
  || no 23 "trevor-prime.com 301" "still referenced ${n}× — it 301s to a TERMINATED host"

# ── #29 watcher_surface ────────────────────────────────────────────────────
v="$(grep -E '^WATCHER_VM_HOST=' "$ENV_LOCAL" 2>/dev/null | cut -d= -f2)"
if [ -n "$v" ] && [ "$FAR_HOST" = "$NEW_HOSTNAME" ]; then
  ok 29 "watcher_surface WATCHER_VM_HOST='${v}' -> ${NEW_HOSTNAME}"
else
  no 29 "watcher_surface" "WATCHER_VM_HOST='${v:-<unset>}'"
fi

# ── #30 watcher_integrity — the OTHER distinct env name (the §2.8 add) ─────
v="$(grep -E '^WATCHER_INTEGRITY_VM_HOST=' "$ENV_LOCAL" 2>/dev/null | cut -d= -f2)"
if [ -n "$v" ] && [ "$FAR_HOST" = "$NEW_HOSTNAME" ]; then
  ok 30 "watcher_integrity WATCHER_INTEGRITY_VM_HOST='${v}' -> ${NEW_HOSTNAME}"
else
  no 30 "watcher_integrity" "WATCHER_INTEGRITY_VM_HOST='${v:-<unset>}' — the row A7 §2.8 added precisely because a script setting WATCHER_VM_HOST misses it"
fi

# ── the negative control: nothing may still be reaching the OLD box ────────
printf '\n══ NEGATIVE CONTROL ══\n'
if grep -qE "^(VM_GATEWAY_IP|HUB_VM_IP|TRAINER_EXECUTOR_URL)=.*${OLD_TAILNET}" "$ENV_LOCAL" 2>/dev/null; then
  no "NC" "old-box references" "a repointed key still names ${OLD_TAILNET}"
else
  ok "NC" "no repointed key still names the old box ${OLD_TAILNET}"
fi

printf '\n%s\n' "$(printf '─%.0s' {1..70})"
printf 'SILENT-ROW ASSERTIONS: %s%d passed%s · %s%d failed%s\n' \
  "$c_grn" "$pass" "$c_off" "$c_red" "$fail" "$c_off"
[ "$fail" -eq 0 ] || printf '%s🚨 A FAILED SILENT ROW PRODUCES NO OTHER ERROR. Do not proceed.%s\n' "$c_red" "$c_off"
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)
