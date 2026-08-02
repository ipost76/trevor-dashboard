#!/usr/bin/env python3
"""Phase-3 calibration: the 2025-10-10 cascade fixture + the two-gate proof.

Proves, against the ACTUAL seeded level-0 thresholds in trainer.db:
  1. The fixture reproduces the −23.6% (PAXG) / −41.8% (ZEC) intraday wicks.
  2. A config exposed to the cascade FAILS the seeded CVaR floor (gate (b)),
     and is therefore rejected by evaluate_compass — the gate's whole reason
     to exist. If the cascade cleared the floor, the floor would be mis-set.
  3. A DD-average alone MISSES the wick (close-based drawdown clears the ceiling)
     while cvar_95 on the intraday-aware per-trade series CATCHES it — both
     numbers computed + shown. This is the evidence that justifies TWO gates.

Dependency-free: `python3 tests/test_cascade_calibration.py`. pytest-compatible.

🚨 THIS FILE USED TO WRITE THE LIVE ``data/trainer.db`` — TWICE PER RUN (B11).
It reached the live store by TWO DISTINCT MECHANISMS, and they needed different fixes:

  * DIRECTLY, in ``_seeded_thresholds()``: a zero-arg ``get_connection()`` that opened
    the live store, set ``PRAGMA journal_mode=WAL`` and ran ``init_schema()`` — 7 DDL
    statements inside a real COMMIT — with every failure eaten by ``except Exception:
    pass``. Fixed by the module-level scratch store below.
  * INDIRECTLY, at the ``evaluate_compass(...)`` call: that function defaults
    ``conn=None`` and then does a FUNCTION-LOCAL ``from lib.trainer_db import
    get_connection``. Nothing on the test side named a database at all, so no grep of
    ``tests/`` for ``get_connection`` could ever have surfaced it. The same scratch
    store closes it, because the redirect happens at path-resolution time inside
    ``get_connection`` rather than at the call site.

Both are now additionally backstopped by the ``_under_test()`` guard inside all four
``lib/*_db.py`` modules, which refuses a live-store resolution from a test entry point.
"""
import atexit
import os
import shutil
import sys
import tempfile

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _ROOT)
sys.path.insert(0, os.path.join(_ROOT, "tests"))

# ── The scratch store (B11) ───────────────────────────────────────────────────────
# Set BEFORE any store call so every resolution in this process — direct or indirect,
# ours or a production default's — lands here and never on data/trainer.db.
_SCRATCH_DIR = tempfile.mkdtemp(
    prefix="cascade_calib_",
    dir="/home/ghost/tmp" if os.path.isdir("/home/ghost/tmp") else None,
)
os.environ["TRAINER_DB_PATH"] = os.path.join(_SCRATCH_DIR, "trainer.db")
atexit.register(shutil.rmtree, _SCRATCH_DIR, True)

from compass_metrics import (  # noqa: E402
    SEED_CVAR_FLOOR,
    SEED_DD_CEILING,
    cvar_95,
    evaluate_compass,
    max_drawdown_frac,
    seed_compass_weights_level0,
    survival_gates,
)
from fixtures.cascade_2025_10_10 import (  # noqa: E402
    PAXG_WICK,
    ZEC_WICK,
    cascade_candidate,
    cascade_net_pnl_series,
    close_based_equity_curve,
    intraday_equity_curve,
)


def _seed_scratch_store():
    """Seed the scratch store's level-0 row with the SEED_* constants.

    Uses the production seeder so the row is written exactly the way production
    writes it. (This is also the only caller ``seed_compass_weights_level0`` has —
    it was a zero-caller live-store writer before B11; see the report at the bottom
    of this file. It is exercised here against the SCRATCH store, never the live one.)
    """
    seed_compass_weights_level0()


# Seeded at MODULE level, not from __main__: this file is also importable and claims
# pytest compatibility, and a seed that only runs under one entry point is the same
# shape as the harness-ordering trap the memory tests carry — a new test function
# added above the harness would run against an unseeded store.
_seed_scratch_store()


def _seeded_thresholds():
    """The level-0 thresholds actually in the SCRATCH trainer.db.

    🚨 THIS NO LONGER SWALLOWS, AND THAT IS THE POINT (B11, defect D1).
    It used to be ``except Exception: pass`` → silently return the SEED_* constants
    with ``source="seed"``. Three separate bugs lived in that one line:

      1. The live-store read could fail for ANY reason and the test still passed —
         the failure was indistinguishable from success, because
      2. ``source`` was computed and then NEVER ASSERTED ON by any caller, and
      3. the live row happened to be byte-identical to the SEED_* constants, so the
         fallback produced the same numbers and was invisible. It was correct by
         coincidence, not by construction.

    Now: a failed read RAISES, and ``source`` is asserted on by every caller.
    """
    from lib.trainer_db import get_connection

    c = get_connection()
    try:
        row = c.execute(
            "SELECT dd_ceiling, cvar_floor FROM compass_weights WHERE level_id = 0"
        ).fetchone()
    finally:
        c.close()
    if row is None:
        raise AssertionError(
            "no level-0 compass_weights row in the scratch store — the seeder did not "
            "run. This used to fall back to SEED_* silently and pass."
        )
    return {"dd_ceiling": float(row[0]), "cvar_floor": float(row[1]), "source": "db"}


def _assert_fixed_bounds(thr):
    """Pin the thresholds to FIXED constants, never to whatever is in a live store.

    🚨 The old test asserted ``cvar < thr["cvar_floor"]`` where ``cvar_floor`` came
    from live production config. That assertion gets EASIER as the live floor rises:
    the bound drifts with the thing it is supposed to be checking, so the test can
    keep passing while the behaviour it guards silently changes. A test must assert
    against a fixed expectation.
    """
    assert thr["source"] == "db", (
        f"thresholds came from {thr['source']!r}, not the seeded store — a swallowed "
        "read must never pass as a seeded default", thr,
    )
    assert abs(thr["dd_ceiling"] - SEED_DD_CEILING) < 1e-12, (thr, SEED_DD_CEILING)
    assert abs(thr["cvar_floor"] - SEED_CVAR_FLOOR) < 1e-12, (thr, SEED_CVAR_FLOOR)


# --------------------------------------------------------------------------
# 1. Fixture reproduces the wicks
# --------------------------------------------------------------------------
def test_fixture_reproduces_wicks():
    assert abs(PAXG_WICK - (-0.236)) < 1e-9, f"PAXG wick {PAXG_WICK} != -0.236"
    assert abs(ZEC_WICK - (-0.418)) < 1e-9, f"ZEC wick {ZEC_WICK} != -0.418"
    print(f"  fixture wicks reproduced: PAXG {PAXG_WICK:.3%}, ZEC {ZEC_WICK:.3%}: PASS")


# --------------------------------------------------------------------------
# 2. A config exposed to the cascade FAILS the seeded CVaR floor
# --------------------------------------------------------------------------
def test_cascade_fails_seeded_cvar_floor():
    thr = _seeded_thresholds()
    _assert_fixed_bounds(thr)
    series = cascade_net_pnl_series()
    cvar = cvar_95(series)
    assert cvar is not None
    assert cvar < thr["cvar_floor"], (
        f"cascade CVaR {cvar:.4f} did NOT breach the seeded floor "
        f"{thr['cvar_floor']:.4f} — floor is mis-calibrated"
    )
    # Prove it's the CVaR gate (not DD) doing the rejecting at the wall.
    g = survival_gates(cascade_candidate(), thr)
    assert g["passed"] is False, g
    assert "cvar_floor" in g["failing"], g
    assert "dd_ceiling" not in g["failing"], (
        "DD gate ALSO fired — the fixture must let DD pass so the CVaR catch "
        "is the demonstrated one", g,
    )
    # Whole-compass verdict against the SEEDED DB thresholds.
    v = evaluate_compass(cascade_candidate(), level=0)
    assert v["survived"] is False and v["verdict"] == "rejected", v
    assert v["consistency"] is None and v["magnitude"] is None, v  # WALL short-circuit
    print(f"  cascade CVaR {cvar:.4f} < seeded floor {thr['cvar_floor']:.4f} "
          f"({thr['source']}) -> REJECTED by gate (b): PASS")


# --------------------------------------------------------------------------
# 3. DD-average MISSES the wick; CVaR CATCHES it (both shown)
# --------------------------------------------------------------------------
def test_dd_misses_cvar_catches():
    thr = _seeded_thresholds()
    _assert_fixed_bounds(thr)
    dd_close = max_drawdown_frac(close_based_equity_curve())
    dd_intra = max_drawdown_frac(intraday_equity_curve())
    cvar = cvar_95(cascade_net_pnl_series())

    # DD-average on the close-based series does NOT trip the ceiling.
    assert dd_close <= thr["dd_ceiling"], (dd_close, thr)
    # Even the HONEST intraday portfolio DD misses (diversification dilutes the
    # single-asset wick) — deepening why CVaR is needed.
    assert dd_intra <= thr["dd_ceiling"], (dd_intra, thr)
    # But CVaR on the per-trade distribution DOES catch it.
    assert cvar is not None and cvar < thr["cvar_floor"], (cvar, thr)

    print("  --- two-gate justification (both computed) ---")
    print(f"    DD-average, close-based : {dd_close:.4%}  (ceiling {thr['dd_ceiling']:.2%}) -> MISSES")
    print(f"    DD-average, intraday    : {dd_intra:.4%}  (ceiling {thr['dd_ceiling']:.2%}) -> MISSES")
    print(f"    CVaR-95, per-trade      : {cvar:.4%}  (floor  {thr['cvar_floor']:.2%}) -> CATCHES")
    print("  DD misses, CVaR catches: PASS")


ALL = [
    test_fixture_reproduces_wicks,
    test_cascade_fails_seeded_cvar_floor,
    test_dd_misses_cvar_catches,
]


if __name__ == "__main__":
    print("=== Phase-3 2025-10-10 cascade calibration ===")
    print(f"  scratch store: {os.environ['TRAINER_DB_PATH']}")
    for fn in ALL:
        fn()
    print("ALL PHASE-3 TESTS PASS")
