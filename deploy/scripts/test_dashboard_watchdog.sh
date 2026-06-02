#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# In-house verification harness for dashboard_health_watchdog.sh (REL-06 + REL-08).
# Drives the REAL watchdog via --once --dry-run with the documented test hooks
# (WATCHDOG_STATE_DIR / WATCHDOG_NOW / WATCHDOG_TEST_HEALTH). Each --once call is a
# fresh process — which also proves the state survives a watchdog-process bounce
# (Restart=always makes that routine). No live service is touched.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
WD="$(cd "$(dirname "$0")" && pwd)/dashboard_health_watchdog.sh"
PASS=0; FAIL=0
ok()   { echo "  ✅ PASS: $*"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ FAIL: $*"; FAIL=$((FAIL+1)); }

STATE="$(mktemp -d)"
BASE=1700000000
export WATCHDOG_STATE_DIR="$STATE"
export FAIL_THRESHOLD=2
export RESTART_COOLDOWN=300
export RESTART_WINDOW_SEC=1800
export MAX_RESTARTS_IN_WINDOW=3
export RESTART_GRACE_SEC=180

# run <epoch> <healthy|fail>  → one --once --dry-run iteration at a fixed clock
run() {
  WATCHDOG_NOW="$1" WATCHDOG_TEST_HEALTH="$2" bash "$WD" --once --dry-run 2>&1
}
hist_count() { [ -f "$STATE/restart_history" ] && grep -c . "$STATE/restart_history" || echo 0; }

echo "=============================================================="
echo "SCENARIO 1 — REL-06: 3 restarts within the window WITH a transient"
echo "  recovery between EACH restart. Pre-fix bug: recovery reset the"
echo "  counter so give-up never fired. Expect: history NOT reset, and"
echo "  give-up (ALERT-ONLY) fires on the 4th failure spell."
echo "=============================================================="
out=""
# spell 1 → restart #1
run $((BASE+0))   fail    >/dev/null
out=$(run $((BASE+1))   fail);    echo "$out" | grep -q "RESTARTING" && echo "  · restart #1 issued"
run $((BASE+2))   healthy >/dev/null   # transient recovery (must NOT clear history)
[ "$(hist_count)" = "1" ] && ok "history kept after recovery #1 (count=1)" || bad "history count after recovery #1 = $(hist_count), expected 1"
# spell 2 → restart #2 (cooldown cleared by +400s)
run $((BASE+400)) fail    >/dev/null
out=$(run $((BASE+401)) fail);    echo "$out" | grep -q "RESTARTING" && echo "  · restart #2 issued"
run $((BASE+402)) healthy >/dev/null
[ "$(hist_count)" = "2" ] && ok "history kept after recovery #2 (count=2)" || bad "history count after recovery #2 = $(hist_count), expected 2"
# spell 3 → restart #3
run $((BASE+800)) fail    >/dev/null
out=$(run $((BASE+801)) fail);    echo "$out" | grep -q "RESTARTING" && echo "  · restart #3 issued"
run $((BASE+802)) healthy >/dev/null
[ "$(hist_count)" = "3" ] && ok "history kept after recovery #3 (count=3) — recovery did NOT reset it" || bad "history count = $(hist_count), expected 3"
# spell 4 → give-up (still inside the 1800s window: BASE+1201 - BASE+1 = 1200 < 1800)
run $((BASE+1200)) fail   >/dev/null
out=$(run $((BASE+1201)) fail)
echo "$out" | grep -q "MANUAL INTERVENTION NEEDED" && ok "give-up ALERT-ONLY fired (loud 🚨 GHOST page) despite the 3 transient recoveries" || bad "give-up did not fire; output: $out"
echo "$out" | grep -q "RESTARTING" && bad "watchdog restarted AGAIN in give-up mode (should not)" || ok "no further restart issued in give-up mode (thrash stopped)"
echo "  --- the loud alert content: ---"
echo "$out" | grep "DRY-RUN alert" | sed 's/^/      /'

echo ""
echo "=============================================================="
echo "SCENARIO 2 — REL-06: genuine recovery ages out of the window →"
echo "  protection auto-resumes (not abandoned forever, not thrashing)."
echo "=============================================================="
# Jump far past the window so every prior restart ages out (>1800s after the last).
# Capture both probes of the spell (the restart may fire on either, depending on the
# consecutive-fail counter carried in from the give-up spell — both are correct).
out=$(run $((BASE+3500)) fail; run $((BASE+3501)) fail)
echo "$out" | grep -q "RESTARTING" && ok "after the window cleared, watchdog resumed protecting (restart fired again)" || bad "watchdog did not resume after window aged out; output: $out"
echo "$out" | grep -q "MANUAL INTERVENTION" && bad "still in give-up after aging out (should have resumed)" || ok "no longer in give-up — aged-out restarts dropped from the window"
[ "$(hist_count)" = "1" ] && ok "window now holds only the fresh post-aging restart (count=1)" || bad "history count = $(hist_count), expected 1 after aging"

echo ""
echo "=============================================================="
echo "SCENARIO 3 — REL-08: disk_cleanup is mid-restart (fresh marker)."
echo "  Expect: watchdog DEFERS — no fight, no restart, not counted."
echo "=============================================================="
STATE="$(mktemp -d)"; export WATCHDOG_STATE_DIR="$STATE"
printf '%s %s\n' "$((BASE+0))" "disk_cleanup" > "$STATE/restart_in_progress"   # disk_cleanup claims it
run $((BASE+1)) fail   >/dev/null
out=$(run $((BASE+2)) fail)
echo "$out" | grep -q "deferring; not restarting, not counting" && ok "watchdog deferred to disk_cleanup's in-progress restart (no fight)" || bad "watchdog did not defer; output: $out"
echo "$out" | grep -q "RESTARTING" && bad "watchdog restarted while disk_cleanup was mid-restart (FIGHT!)" || ok "watchdog issued NO competing restart"
[ "$(hist_count)" = "0" ] && ok "deferred restart NOT counted against the give-up budget" || bad "history count = $(hist_count), expected 0"

echo ""
echo "=============================================================="
echo "SCENARIO 4 — REL-08: when the watchdog IS the decider (no external"
echo "  marker) it restarts normally AND writes its own stand-down marker."
echo "=============================================================="
STATE="$(mktemp -d)"; export WATCHDOG_STATE_DIR="$STATE"
run $((BASE+1)) fail   >/dev/null
out=$(run $((BASE+2)) fail)
echo "$out" | grep -q "RESTARTING" && ok "watchdog restarts normally when it is the sole decider" || bad "watchdog did not restart; output: $out"
if [ -f "$STATE/restart_in_progress" ] && grep -q "watchdog" "$STATE/restart_in_progress"; then
  ok "watchdog wrote its own 'watchdog'-owned stand-down marker (so disk_cleanup defers)"
else
  bad "watchdog did not write a stand-down marker"
fi
# A watchdog-owned marker must NOT make the watchdog defer to itself.
out=$(run $((BASE+700)) fail; run $((BASE+701)) fail)
echo "$out" | grep -q "deferring; not restarting" && bad "watchdog deferred to its OWN marker (wrong)" || ok "watchdog does not defer to its own marker (cooldown governs its cadence)"

echo ""
echo "=============================================================="
printf "RESULT: %d passed, %d failed\n" "$PASS" "$FAIL"
echo "=============================================================="
[ "$FAIL" = "0" ]
