#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# TREVOR Hub health watchdog (2026-05-29, RM-DASH async-bridge wave)
#   2026-06-02 REL-06/REL-08 hardening — see "Changelog" below.
#
# WHY: trevor-dashboard.service has Restart=always but NO systemd WatchdogSec, so
# systemd only restarts the process on EXIT. A wedged-but-alive Node event loop
# (the 2026-05-29 incident) never exits → never restarts. This external watchdog
# polls /api/health (Python-free, can't itself wedge) and self-heals a hang.
#
# Sanctioned per Ghost 2026-05-29: trevor-dashboard.service MAY auto-restart via
# THIS watchdog without per-incident approval. It is the ONLY sanctioned auto-restart
# AND (REL-08) the SINGLE restart authority — all other actors coordinate through it.
#
# Self-contained: no bot-code dependency. Reads DISCORD_BOT_TOKEN from the shared
# .env (read-only) and POSTs alerts to #qa-agent via the Bot-token REST idiom
# (mirrors qa_channel_guard.post_to_reports / discord_file_delivery._post_single_file).
#
# Behaviour (Ghost-approved thresholds):
#   • poll /api/health every CHECK_INTERVAL s (curl --max-time MAX_TIME)
#   • a "failure" = no 2xx within MAX_TIME (timeout / refused / 5xx). A 200
#     "degraded" (DB file missing) is NOT a failure — restarting can't fix that
#     and would loop; only a true non-response (the wedge signature) counts.
#   • restart after FAIL_THRESHOLD consecutive failures
#   • never re-restart within RESTART_COOLDOWN s of the last restart
#   • REL-06 — WINDOWED give-up: MAX_RESTARTS_IN_WINDOW restarts within
#     RESTART_WINDOW_SEC → ALERT-ONLY (stop restarting; keep loudly paging Ghost,
#     rate-limited). The restart history PERSISTS in a state file and is NOT
#     cleared by a transient recovery — so a recover/wedge/recover/wedge thrash
#     can no longer defeat the give-up (the pre-REL-06 bug). Old restarts age out
#     of the window naturally → protection auto-resumes after a genuine recovery.
#   • REL-08 — SINGLE restart authority: while ANY actor (this watchdog or
#     disk_cleanup.sh's weekly memory-hygiene restart) is mid-restart it writes a
#     shared stand-down marker; the others defer instead of fighting. The act of
#     restarting is serialized with an flock.
#   • #qa-agent alert on every restart (+ recovery + give-up notices)
#
# State (REL-06/08 — survives a watchdog-process restart, which Restart=always makes
# routine; pre-REL-06 in-memory counters reset on every watchdog bounce too):
#   $STATE_DIR/restart_history     — one restart epoch per line (windowed give-up)
#   $STATE_DIR/restart_in_progress — "<epoch> <owner>" stand-down marker (REL-08)
#   $STATE_DIR/restart.lock        — flock target serializing the act of restarting
#   $STATE_DIR/consecutive_fails   — persisted consecutive-failure counter
#   $STATE_DIR/was_unhealthy       — 1 while in a failed spell (drives RECOVERED msg)
#   $STATE_DIR/last_alertonly      — last give-up re-alert epoch (rate-limit)
#
# Usage:
#   dashboard_health_watchdog.sh            # long-running loop (systemd service)
#   dashboard_health_watchdog.sh --once     # one check iteration, then exit (test)
#   dashboard_health_watchdog.sh --dry-run  # print restart/alert actions, don't execute
#   (flags combine: --once --dry-run)
#
# Test hooks (INERT in production — only active when the env var is set; never set
# in the systemd unit): WATCHDOG_STATE_DIR (override state dir), WATCHDOG_NOW
# (override the clock, epoch seconds), WATCHDOG_TEST_HEALTH (healthy|fail — bypass curl).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

# ── Config (env-overridable) ────────────────────────────────────────────────
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3333/api/health}"
SERVICE="${WATCHDOG_SERVICE:-trevor-dashboard.service}"
CHECK_INTERVAL="${CHECK_INTERVAL:-30}"       # seconds between checks
MAX_TIME="${MAX_TIME:-15}"                    # curl hard timeout
FAIL_THRESHOLD="${FAIL_THRESHOLD:-2}"         # consecutive fails → restart
RESTART_COOLDOWN="${RESTART_COOLDOWN:-300}"   # min seconds between restarts (5 min)
# REL-06: windowed give-up. N restarts within M seconds → alert-only. Defaults
# preserve the historic "3 strikes" intent but now over a rolling 30-min window
# (back-compat: an old MAX_RESTART_CYCLES override is honored as the count).
RESTART_WINDOW_SEC="${RESTART_WINDOW_SEC:-1800}"                         # 30 min
MAX_RESTARTS_IN_WINDOW="${MAX_RESTARTS_IN_WINDOW:-${MAX_RESTART_CYCLES:-3}}"
ALERT_ONLY_REALERT="${ALERT_ONLY_REALERT:-1800}" # re-alert cadence in give-up mode (30 min)
# REL-08: cross-actor stand-down marker freshness. While a marker is younger than
# this, other actors defer. Doubles as the anti-deadlock auto-expiry.
RESTART_GRACE_SEC="${RESTART_GRACE_SEC:-180}"
ENV_FILE="${ENV_FILE:-/home/trevor/trevor/.env}"
QA_AGENT_CHANNEL_ID="${QA_AGENT_CHANNEL_ID:-1479969192139690029}"
DISCORD_API_BASE="https://discord.com/api/v10"

# REL-06/08 persistent state (overridable for tests).
STATE_DIR="${WATCHDOG_STATE_DIR:-/home/trevor/scripts/.watchdog_state}"
RESTART_HISTORY="${STATE_DIR}/restart_history"
RESTART_MARKER="${STATE_DIR}/restart_in_progress"
RESTART_LOCK="${STATE_DIR}/restart.lock"
CF_FILE="${STATE_DIR}/consecutive_fails"
WU_FILE="${STATE_DIR}/was_unhealthy"
ALERTONLY_FILE="${STATE_DIR}/last_alertonly"

DRY_RUN=0
ONCE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --once)    ONCE=1 ;;
  esac
done

log() { echo "[$(TZ='America/New_York' date '+%Y-%m-%d %H:%M:%S %Z')] $*"; }

# Clock — overridable in tests so a 30-min window can be exercised in milliseconds.
now() {
  if [ -n "${WATCHDOG_NOW:-}" ]; then echo "$WATCHDOG_NOW"; else date +%s; fi
}

# ── Tiny persisted-state helpers ─────────────────────────────────────────────
ensure_state_dir() { mkdir -p "$STATE_DIR" 2>/dev/null || true; }
read_int()  { local f="$1" d="${2:-0}" v; if [ -f "$f" ]; then v="$(cat "$f" 2>/dev/null)"; echo "${v:-$d}"; else echo "$d"; fi; }
write_int() { ensure_state_dir; printf '%s\n' "$2" > "$1"; }

# ── Discord alert to #qa-agent (Bot-token REST idiom) ───────────────────────
discord_token() {
  # Read DISCORD_BOT_TOKEN from the shared .env without sourcing it (avoids
  # executing arbitrary lines). Strips optional quotes.
  [ -r "$ENV_FILE" ] || { echo ""; return; }
  grep -E '^DISCORD_BOT_TOKEN=' "$ENV_FILE" 2>/dev/null | head -1 \
    | sed -E 's/^DISCORD_BOT_TOKEN=//; s/^["'"'"']//; s/["'"'"']$//'
}

alert_qa() {
  local message="$1"
  local ts; ts="$(TZ='America/New_York' date '+%Y-%m-%d %H:%M:%S %Z')"
  local content="🛠️ **Hub watchdog** [${ts}]\n${message}"
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN alert #qa-agent: ${message}"
    return 0
  fi
  local token; token="$(discord_token)"
  if [ -z "$token" ]; then
    log "WARN: DISCORD_BOT_TOKEN not found in ${ENV_FILE} — alert skipped: ${message}"
    return 1
  fi
  # JSON-escape via jq if present, else a minimal sed fallback.
  local payload
  if command -v jq >/dev/null 2>&1; then
    payload="$(jq -nc --arg c "$content" '{content: $c}')"
  else
    local esc; esc="$(printf '%s' "$content" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    payload="{\"content\":\"${esc}\"}"
  fi
  curl -sS -m 20 -X POST \
    -H "Authorization: Bot ${token}" \
    -H "Content-Type: application/json" \
    -H "User-Agent: TREVOR-Watchdog/1.0 (+https://trevor-prime.com)" \
    -d "$payload" \
    "${DISCORD_API_BASE}/channels/${QA_AGENT_CHANNEL_ID}/messages" \
    -o /dev/null -w "qa-agent alert HTTP %{http_code}\n" 2>&1 | while read -r l; do log "$l"; done
}

restart_service() {
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN: would run: sudo systemctl restart ${SERVICE}"
    return 0
  fi
  sudo systemctl restart "$SERVICE"
}

# ── Health probe: 0 = healthy/responsive, 1 = wedge-failure ─────────────────
# Success = HTTP 2xx within MAX_TIME. A 200 with status="degraded" is still
# responsive → treated as healthy (restart can't fix a missing DB file).
check_health() {
  # Test hook — bypass curl entirely when WATCHDOG_TEST_HEALTH is set.
  if [ -n "${WATCHDOG_TEST_HEALTH:-}" ]; then
    [ "$WATCHDOG_TEST_HEALTH" = "healthy" ] && return 0
    log "health probe: TEST forced failure"
    return 1
  fi
  local code
  code="$(curl -sS -m "$MAX_TIME" -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null)"
  if [ "$code" = "200" ] || [ "$code" = "204" ]; then
    return 0
  fi
  log "health probe: HTTP ${code:-000} (no 2xx within ${MAX_TIME}s)"
  return 1
}

# ── REL-06 windowed restart accounting ───────────────────────────────────────
# Prune restart_history to the rolling window and echo the surviving count.
# This is the load-bearing give-up logic: it counts ALL restarts in the window
# regardless of any transient recoveries between them.
prune_and_count_restarts() {
  local cutoff count=0 tmp epoch
  cutoff=$(( $(now) - RESTART_WINDOW_SEC ))
  [ -f "$RESTART_HISTORY" ] || { echo 0; return; }
  tmp="$(mktemp "${STATE_DIR}/.hist.XXXXXX" 2>/dev/null)" || tmp="$(mktemp)"
  while read -r epoch; do
    case "$epoch" in ''|*[!0-9]*) continue ;; esac
    if [ "$epoch" -ge "$cutoff" ]; then
      printf '%s\n' "$epoch" >> "$tmp"
      count=$((count + 1))
    fi
  done < "$RESTART_HISTORY"
  mv -f "$tmp" "$RESTART_HISTORY" 2>/dev/null || rm -f "$tmp"
  echo "$count"
}

record_restart() { ensure_state_dir; now >> "$RESTART_HISTORY"; }

last_restart_epoch() {
  local v=""
  [ -f "$RESTART_HISTORY" ] && v="$(tail -1 "$RESTART_HISTORY" 2>/dev/null)"
  echo "${v:-0}"
}

# ── REL-08 cross-actor stand-down marker ─────────────────────────────────────
mark_restart_in_progress() {  # $1 = owner (watchdog|disk_cleanup)
  ensure_state_dir
  printf '%s %s\n' "$(now)" "${1:-watchdog}" > "$RESTART_MARKER"
}
clear_restart_marker() { rm -f "$RESTART_MARKER" 2>/dev/null || true; }

# True (0) iff a FRESH restart marker owned by SOMEONE ELSE exists — i.e. another
# actor is mid-restart and this watchdog must defer. Our own (owner=watchdog)
# marker is ignored here (the cooldown governs our own re-restart cadence).
external_restart_active() {
  [ -f "$RESTART_MARKER" ] || return 1
  local line m owner
  line="$(cat "$RESTART_MARKER" 2>/dev/null)"
  m="${line%% *}"; owner="${line##* }"
  [ "$owner" = "watchdog" ] && return 1
  case "$m" in ''|*[!0-9]*) return 1 ;; esac
  [ $(( $(now) - m )) -lt "$RESTART_GRACE_SEC" ]
}

# Perform the restart as the SOLE authority, serialized under the shared flock so
# a simultaneous disk_cleanup can't fire at the same instant. All side-effects are
# file-based (the subshell's in-memory changes wouldn't propagate to the parent).
do_coordinated_restart() {
  local attempt="$1"
  ensure_state_dir
  (
    flock -w 10 9 || { log "WARN: could not acquire restart lock in 10s — skipping this cycle"; exit 1; }
    if external_restart_active; then
      log "external restart began while awaiting the lock — deferring, not restarting"
      exit 0
    fi
    mark_restart_in_progress "watchdog"
    alert_qa "⚠️ /api/health failed ${FAIL_THRESHOLD}×+ — restarting \`${SERVICE}\` (windowed restart ${attempt}; give-up at ${MAX_RESTARTS_IN_WINDOW}/$((RESTART_WINDOW_SEC / 60))min)."
    log "RESTARTING ${SERVICE} (windowed restart ${attempt}/${MAX_RESTARTS_IN_WINDOW} within $((RESTART_WINDOW_SEC / 60))min)"
    if restart_service; then
      record_restart
      alert_qa "↻ \`${SERVICE}\` restart issued. Watching for recovery."
    else
      alert_qa "❌ \`sudo systemctl restart ${SERVICE}\` FAILED (windowed restart ${attempt}). Check watchdog sudo rights."
    fi
  ) 9>"$RESTART_LOCK"
}

# ── One check iteration ──────────────────────────────────────────────────────
iterate() {
  local cf wu
  cf="$(read_int "$CF_FILE" 0)"
  wu="$(read_int "$WU_FILE" 0)"

  if check_health; then
    if [ "$wu" = "1" ]; then
      # Recovery. Report how many restarts are still inside the window — and
      # CRUCIALLY do NOT clear restart_history (the REL-06 fix: a transient
      # recovery must not reset the windowed give-up counter).
      local rc; rc="$(prune_and_count_restarts)"
      if [ "$rc" -gt 0 ]; then
        alert_qa "✅ Hub RECOVERED — /api/health responding again (${rc} restart(s) in the last $((RESTART_WINDOW_SEC / 60))min)."
      fi
      clear_restart_marker   # our recovery confirmed → release the stand-down marker
    fi
    write_int "$CF_FILE" 0
    write_int "$WU_FILE" 0
    return 0
  fi

  # Unhealthy.
  write_int "$WU_FILE" 1
  cf=$((cf + 1))
  write_int "$CF_FILE" "$cf"
  log "consecutive failures: ${cf}/${FAIL_THRESHOLD}"
  [ "$cf" -ge "$FAIL_THRESHOLD" ] || return 0

  # REL-08: another actor (disk_cleanup) is mid-restart → stand down. Don't fight,
  # don't count its restart against our give-up budget.
  if external_restart_active; then
    log "external restart in progress (disk_cleanup) — deferring; not restarting, not counting"
    return 0
  fi

  local now_s; now_s="$(now)"
  local n_window; n_window="$(prune_and_count_restarts)"

  # REL-06: windowed give-up → ALERT-ONLY. Persistent; a transient recovery can no
  # longer reset this. Loudly pages Ghost (rate-limited), never silently abandons.
  if [ "$n_window" -ge "$MAX_RESTARTS_IN_WINDOW" ]; then
    local lae; lae="$(read_int "$ALERTONLY_FILE" 0)"
    if [ $(( now_s - lae )) -ge "$ALERT_ONLY_REALERT" ]; then
      alert_qa "🚨 **GHOST — MANUAL INTERVENTION NEEDED.** Hub restarted ${n_window}× within $((RESTART_WINDOW_SEC / 60))min — windowed give-up threshold (${MAX_RESTARTS_IN_WINDOW}) reached. **NOT restarting further** (avoiding restart-thrash). \`${HEALTH_URL}\` still failing — needs a human."
      write_int "$ALERTONLY_FILE" "$now_s"
    else
      log "alert-only (give-up) mode: re-alert suppressed (within ${ALERT_ONLY_REALERT}s)"
    fi
    return 0
  fi

  # Cooldown vs the last restart (derived from history — survives watchdog bounce).
  local lre; lre="$(last_restart_epoch)"
  if [ $(( now_s - lre )) -lt "$RESTART_COOLDOWN" ]; then
    log "within ${RESTART_COOLDOWN}s restart cooldown (last restart $(( now_s - lre ))s ago) — waiting"
    return 0
  fi

  # Restart as the single authority.
  do_coordinated_restart "$((n_window + 1))"
  write_int "$CF_FILE" 0
  return 0
}

ensure_state_dir
log "watchdog start — url=${HEALTH_URL} interval=${CHECK_INTERVAL}s max_time=${MAX_TIME}s fail_threshold=${FAIL_THRESHOLD} cooldown=${RESTART_COOLDOWN}s window=${RESTART_WINDOW_SEC}s max_in_window=${MAX_RESTARTS_IN_WINDOW} grace=${RESTART_GRACE_SEC}s state_dir=${STATE_DIR} dry_run=${DRY_RUN} once=${ONCE}"

if [ "$ONCE" = "1" ]; then
  iterate
  exit 0
fi

while true; do
  iterate
  sleep "$CHECK_INTERVAL"
done
