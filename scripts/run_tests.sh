#!/usr/bin/env bash
# run_tests.sh — run every tests/test_*.py under containment, one command.
#
# Usage:  bash scripts/run_tests.sh            # all 29
#         bash scripts/run_tests.sh test_trainer_bandit.py test_memory_query.py
#
# Exit: 0 all passed | 1 one or more failed/errored.
#
# ═══════════════════════════════════════════════════════════════════════════════
# 🚨 WHY THIS SPAWNS A SUBPROCESS PER FILE INSTEAD OF IMPORTING THEM
# ═══════════════════════════════════════════════════════════════════════════════
# B11's live-store guard lives in get_connection() in all four lib/*_db.py modules
# and decides "am I under test?" from basename(sys.argv[0]).startswith("test_").
#
# So a runner that imports the tests into ONE parent process makes argv[0] the
# RUNNER's name — and the guard goes quiet for every store at once. MEASURED at B7
# with a probe named run_all_probe.py: _under_test() returned False for all four
# stores and every live <repo>/data/*.db path became resolvable again.
#
# 🚨 THE OBVIOUS RUNNER WOULD HAVE SILENTLY RE-OPENED EVERY ESCAPE THIS REPO JUST
# SPENT TWO COMMITS CLOSING. Spawning `python3 tests/test_X.py` keeps argv[0] as the
# test file, so B11's guard stays ARMED rather than being bypassed by its own
# harness. It is the house invocation pattern, run 29 times.
#
# The per-file process is load-bearing a second way: os.environ is process-global,
# so in a single-process run one file's module-level *_DB_PATH accidentally protects
# whichever files import after it. That makes an escape vanish without being fixed
# and reappear the moment ordering shifts. One process per file, no shared env.
#
# BELT: we also export all four *_DB_PATH to a per-run scratch dir, so a test that
# forgets to call _containment.activate() is still contained. Guard (name-based) and
# belt (env-based) fail in different directions; neither alone is enough.
set -uo pipefail

REPO="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO" || exit 1

# House rule: scratch under /home, never /tmp (/tmp is noexec on the VM).
SCRATCH_PARENT="/home/ghost/tmp"
[ -d "$SCRATCH_PARENT" ] || SCRATCH_PARENT="$REPO/.test-scratch"
mkdir -p "$SCRATCH_PARENT"
SCRATCH="$(mktemp -d "$SCRATCH_PARENT/b7_run_XXXXXXXX")"
RESULTS="$SCRATCH/results.txt"
LOGDIR="$SCRATCH/logs"
mkdir -p "$LOGDIR"
trap 'rm -rf "$SCRATCH"' EXIT

# ── the belt ────────────────────────────────────────────────────────────────
export TRAINER_DB_PATH="$SCRATCH/trainer.db"
export WATCHER_DB_PATH="$SCRATCH/watcher.db"
export WATCHER_INTEGRITY_DB_PATH="$SCRATCH/watcher_integrity.db"
export MEMORY_DB_PATH="$SCRATCH/memory.db"

# 🚨 FAIL CLOSED. If any store still resolves under <repo>/data/, do not run a
# single test. There is no fallback branch here on purpose.
if ! python3 -c "
import sys; sys.path.insert(0, 'tests')
import _containment
_containment.verify()
" 2>"$SCRATCH/contain.err"; then
    echo "🚨 CONTAINMENT COULD NOT BE ESTABLISHED — NO TESTS WERE RUN." >&2
    cat "$SCRATCH/contain.err" >&2
    exit 1
fi

PER_TEST_TIMEOUT="${PER_TEST_TIMEOUT:-300}"

if [ "$#" -gt 0 ]; then
    FILES=()
    for a in "$@"; do FILES+=("tests/$(basename -- "$a")"); done
else
    mapfile -t FILES < <(find tests -maxdepth 1 -name 'test_*.py' | sort)
fi

total=${#FILES[@]}
pass=0; fail=0; i=0

echo "═══ run_tests.sh — $total file(s) under containment ═══"
echo "scratch: $SCRATCH"
echo

for f in "${FILES[@]}"; do
    i=$((i + 1))
    base="$(basename -- "$f")"
    log="$LOGDIR/${base%.py}.log"

    if [ ! -f "$f" ]; then
        printf '  [%2d/%2d] %-42s UNRUNNABLE (file not found)\n' "$i" "$total" "$base"
        echo "UNRUNNABLE $base file-not-found" >>"$RESULTS"
        fail=$((fail + 1)); continue
    fi

    # argv[0] IS the test file — this is what keeps B11's guard armed.
    timeout "$PER_TEST_TIMEOUT" python3 "$f" >"$log" 2>&1
    rc=$?

    if [ "$rc" -eq 0 ]; then
        printf '  [%2d/%2d] %-42s PASS\n' "$i" "$total" "$base"
        echo "PASS $base 0" >>"$RESULTS"
        pass=$((pass + 1))
    elif [ "$rc" -eq 124 ]; then
        printf '  [%2d/%2d] %-42s TIMEOUT (%ss)\n' "$i" "$total" "$base" "$PER_TEST_TIMEOUT"
        echo "TIMEOUT $base 124" >>"$RESULTS"
        fail=$((fail + 1))
    else
        printf '  [%2d/%2d] %-42s FAIL (rc=%d)\n' "$i" "$total" "$base" "$rc"
        echo "FAIL $base $rc" >>"$RESULTS"
        fail=$((fail + 1))
    fi
done

echo
echo "═══ SUMMARY: $pass passed, $fail failed, $total total ═══"

if [ "$fail" -gt 0 ]; then
    echo
    echo "── failing files (full output below, never truncated) ──"
    while read -r status base rc; do
        case "$status" in
            FAIL|TIMEOUT|UNRUNNABLE)
                echo
                echo "──────── $base ($status rc=$rc) ────────"
                cat "$LOGDIR/${base%.py}.log" 2>/dev/null || echo "(no log)"
                ;;
        esac
    done <"$RESULTS"
fi

# Keep the logs when anything failed — the scratch trap would otherwise eat them.
if [ "$fail" -gt 0 ]; then
    KEEP="$SCRATCH_PARENT/b7_last_failing_logs"
    rm -rf "$KEEP"; cp -a "$LOGDIR" "$KEEP" 2>/dev/null && echo && echo "logs kept: $KEEP"
fi

[ "$fail" -eq 0 ]
