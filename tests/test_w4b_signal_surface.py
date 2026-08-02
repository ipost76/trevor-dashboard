#!/usr/bin/env python3
"""W4b — the signal surface: state derivation, the conversion join, both clocks.

🚨 RUNNER: a `__main__` self-runner, NOT pytest. pytest is genuinely absent from
this WSL venv (CLAUDE.md measurement law 4). Run it with:

    venv/bin/python3 tests/test_w4b_signal_surface.py

WHAT THIS PROVES

The requirement is that Ghost can tell three states apart at a glance:
  (a) no signals were produced
  (b) signals were produced and none converted
  (c) the replica has not caught up
All three used to render as an identical empty screen, and during 18 hours of
zero entries the truth was (b) with the system producing ~26 signals normally.

So the controls drive the REAL loaded functions with each input:
  · Python     — query_signals.derive_state, imported from the module the Hub
                 actually runs.
  · TypeScript — src/lib/et-clock.ts, compiled by the repo's own tsc and driven
                 by node.
Never a re-implementation: one can faithfully reproduce the very bug it is
meant to catch, so restating the logic proves nothing (CLAUDE.md's B9 lesson).

🚨 The clock control is the one to keep. This codebase's recurring defect is
mixing REAL-UTC columns with NAIVE-EASTERN ones, and W4b introduced a surface
sourced entirely from UTC columns while the neighbouring trade rows are ET. The
two mistakes are mirror images — converting an ET value shows it 4h early,
raw-slicing a UTC value shows it 4h late — so both directions are asserted.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

FAILURES: list[str] = []
CHECKS = 0


def check(label: str, got, want) -> None:
    global CHECKS
    CHECKS += 1
    if got == want:
        print(f"  PASS  {label}: {got!r}")
    else:
        print(f"  FAIL  {label}: got {got!r}, want {want!r}")
        FAILURES.append(f"{label}: got {got!r}, want {want!r}")


def _scanner(cycles: int, posted: int = 0) -> dict:
    return {"cycles": cycles, "ticker_scans": cycles * 10, "candidates": 0,
            "signals_posted": posted, "newest_scan_utc": None,
            "scan_age_seconds": None}


# ─────────────────────────────────────────────────────────────────────────────
# 1. THE THREE STATES — query_signals.derive_state
# ─────────────────────────────────────────────────────────────────────────────
def test_state_derivation() -> None:
    print("\n[1] Python — query_signals.derive_state (REAL module)")
    import query_signals as qs

    converted = [{"converted": True}, {"converted": False}]
    unconverted = [{"converted": False}, {"converted": False}]

    # (a) the scanner ran and found nothing. Distinguishable from a dead
    # scanner precisely BECAUSE cycles > 0.
    check("cycles>0, no signals      (a)", qs.derive_state(_scanner(476), []), "no_signals")
    # (b) THE 18-HOUR CASE. Signals produced, none converted.
    check("signals, none converted   (b)", qs.derive_state(_scanner(476, 35), unconverted), "signals_no_trades")
    # Healthy.
    check("signals, one converted       ", qs.derive_state(_scanner(476, 35), converted), "converting")
    # No scan rows at all — named as an OBSERVATION, never diagnosed as death.
    check("no scan cycles at all        ", qs.derive_state(_scanner(0), []), "scanner_silent")

    # 🚨 A silent scanner outranks a signal list: if no cycles were recorded we
    # cannot claim the scanner is fine, whatever else happens to be in the table.
    check("no cycles but signals present", qs.derive_state(_scanner(0), unconverted), "scanner_silent")

    # 🚨 (c) IS NOT ONE OF THESE, and the proof is STRUCTURAL rather than a
    # docstring grep: derive_state takes only (scanner, signals), so it has no
    # access to replica age and CANNOT fold staleness into its verdict even by
    # accident. A stale view therefore still reports what it saw, and the
    # caller renders staleness as a banner over it.
    import inspect
    params = list(inspect.signature(qs.derive_state).parameters)
    check("derive_state params          ", params, ["scanner", "signals"])

    # And the flag genuinely exists on the payload, separately.
    src = (REPO / "query_signals.py").read_text()
    check("replica_stale emitted separately", '"replica_stale"' in src, True)

    # Exhaustive: no input combination can produce a value outside the four.
    valid = {"converting", "signals_no_trades", "no_signals", "scanner_silent"}
    produced = {
        qs.derive_state(_scanner(c, p), sig)
        for c in (0, 1, 476)
        for p in (0, 35)
        for sig in ([], unconverted, converted)
    }
    check("all outputs are valid states ", produced <= valid, True)


# ─────────────────────────────────────────────────────────────────────────────
# 2. EXCISED (B11) — it was a production monitor wearing a test's name.
# ─────────────────────────────────────────────────────────────────────────────
# ``test_conversion_join_is_exact`` opened the live 0444 replica through the
# /home/trevor/trevor shim with a raw ``sqlite3.connect(mode=ro)`` and asserted over
# whatever rows happened to be there. Three separate reasons it did not belong here:
#
#   1. IT COULD NOT DETECT A CODE REGRESSION AT ALL. It carried its OWN inline SQL
#      rather than calling the code under test, so it only ever measured the DATA.
#      Every other block in this file exercises real code — this one exercised none.
#   2. It hardcoded EXACTLY 11 rows against a growing table, so it reddens with time
#      and nothing broken. (Measured at B11's baseline it was ALREADY red: got 26,
#      want 11 — so removing it hides no regression, it removes a standing false
#      alarm that had been failing since the table grew past the hardcoded number.)
#   3. It compared two live tables over a ROLLING 24h window — a data-drift check,
#      which is monitoring, not testing.
#
# A production monitor belongs on a monitoring surface, where a red state pages
# someone. In a test file it trains readers to ignore a failing suite, which is the
# defect class this campaign keeps finding.
#
# ⚠️ Removing it also took the file's ONLY raw ``sqlite3.connect`` with it — a site
# the ``get_connection`` guard is structurally blind to (it bypassed the function
# entirely). Blocks [1], [3] and [4] are untouched and reach no store.


# ─────────────────────────────────────────────────────────────────────────────
# 3. THE TWO CLOCKS — src/lib/et-clock.ts, compiled and executed
# ─────────────────────────────────────────────────────────────────────────────
NODE_DRIVER = r"""
const m = require(process.argv[2]);
const out = {
  // The PROVEN event: signal 7495 created 2026-07-29 21:17:52 UTC, whose trade
  // #101743 opened_at reads 17:18:27 ET. 21:17:52 UTC == 17:17 ET (EDT, -4).
  sqlite_shape:   m.fmtEtFromUtc("2026-07-29 21:17:52"),
  // Python isoformat with an explicit offset must NOT get a second 'Z'.
  iso_offset:     m.fmtEtFromUtc("2026-07-30T21:47:59.368260+00:00"),
  already_z:      m.fmtEtFromUtc("2026-07-30T21:47:59Z"),
  // EST side of DST — January is -5, so 21:17 UTC is 16:17 ET, not 17:17.
  winter_est:     m.fmtEtFromUtc("2026-01-15 21:17:52"),
  // Midnight rollover: 02:30 UTC is the PREVIOUS evening in ET.
  utc_midnight:   m.fmtEtFromUtc("2026-07-30 02:30:00"),
  // Honest failures — never NaN, never a silent blank.
  null_in:        m.fmtEtFromUtc(null),
  undefined_in:   m.fmtEtFromUtc(undefined),
  short_in:       m.fmtEtFromUtc("2026-07-30"),
  garbage_in:     m.fmtEtFromUtc("not-a-date-at-all"),
  parse_null:     m.parseUtc("nope") === null,
};
console.log(JSON.stringify(out));
"""


def test_clock_conversion() -> None:
    print("\n[3] TypeScript — src/lib/et-clock.ts (compiled by the repo's tsc)")
    scratch = tempfile.mkdtemp(prefix="w4b-", dir=str(Path.home()))  # /home, never /tmp
    try:
        cp = subprocess.run(
            ["npx", "tsc", "src/lib/et-clock.ts", "--outDir", scratch,
             "--module", "commonjs", "--target", "es2020"],
            cwd=str(REPO), capture_output=True, text=True, timeout=180)
        if cp.returncode != 0:
            FAILURES.append(f"tsc: {cp.stdout}{cp.stderr}")
            print(f"  FAIL  tsc compile: {cp.stdout}{cp.stderr}")
            return
        driver = os.path.join(scratch, "driver.js")
        Path(driver).write_text(NODE_DRIVER)
        run = subprocess.run(["node", driver, os.path.join(scratch, "et-clock.js")],
                             capture_output=True, text=True, timeout=60)
        if run.returncode != 0:
            FAILURES.append(f"node: {run.stderr}")
            print(f"  FAIL  node driver: {run.stderr}")
            return
        r = json.loads(run.stdout)
        # 🚨 THE LOAD-BEARING ONE. 17:17 proves the UTC value was converted.
        # 21:17 would mean it was raw-sliced (the 4-hours-late bug); 13:17 would
        # mean it was converted twice (the 4-hours-early bug).
        check("sqlite UTC -> ET (EDT)  ", r["sqlite_shape"], "17:17")
        check("iso +00:00 offset       ", r["iso_offset"], "17:47")
        check("already-Z string        ", r["already_z"], "17:47")
        check("winter UTC -> ET (EST)  ", r["winter_est"], "16:17")
        check("UTC 02:30 -> prev ET eve", r["utc_midnight"], "22:30")
        check("null   -> --:--         ", r["null_in"], "--:--")
        check("undef  -> --:--         ", r["undefined_in"], "--:--")
        check("short  -> --:--         ", r["short_in"], "--:--")
        check("garbage-> --:--         ", r["garbage_in"], "--:--")
        check("parseUtc rejects garbage", r["parse_null"], True)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


# ─────────────────────────────────────────────────────────────────────────────
# 4. THE W4a CARRY-FORWARDS — no second mode authority, no live-only reader
# ─────────────────────────────────────────────────────────────────────────────
def test_w4a_invariants_hold() -> None:
    print("\n[4] W4a carry-forwards")
    new_files = [
        "query_signals.py",
        "src/app/api/auto/signals/route.ts",
        "src/components/autotrader-v2/signals-card.tsx",
        "src/lib/et-clock.ts",
    ]
    for rel in new_files:
        src = (REPO / rel).read_text()
        # 🚨 No new live-only reader. W4a removed this filter from five readers
        # because it made the paper run invisible; a new surface must not
        # reintroduce the shape on a fresh file.
        sql = [ln.strip() for ln in src.splitlines()
               if "trade_mode='live'" in ln
               and not ln.lstrip().startswith(("#", "//", "--", "*"))
               and "`" not in ln]
        check(f"{rel:46} no live-only filter", sql, [])

        # 🚨 No SECOND mode derivation. src/lib/trading-mode.ts is the single
        # authority; a new surface reading the config flags itself is exactly
        # the duplication-by-omission that produced the false LIVE badge.
        flags = [f for f in ("PAPER_WINDOW_ENABLED", "AUTO_LIVE_ENABLED", "TRADING_MODE")
                 if f in src and rel != "query_signals.py"]
        check(f"{rel:46} no mode flags read ", flags, [])

    # query_signals.py may NAME the flags in prose (its header explains why it
    # deliberately ignores decision_log's "mode" key), but must never read one.
    qs = (REPO / "query_signals.py").read_text()
    reads = [ln.strip() for ln in qs.splitlines()
             if "PAPER_WINDOW_ENABLED" in ln and "SELECT" in ln.upper()]
    check("query_signals.py reads no mode flag", reads, [])


def main() -> int:
    print("W4b signal-surface controls  (self-runner; pytest absent on WSL)")
    print("=" * 70)
    test_state_derivation()
    test_clock_conversion()
    test_w4a_invariants_hold()
    print("=" * 70)
    if FAILURES:
        print(f"FAILED — {len(FAILURES)} of {CHECKS} checks")
        for f in FAILURES:
            print(f"  · {f}")
        return 1
    print(f"PASSED — {CHECKS}/{CHECKS} checks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
