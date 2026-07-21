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
"""
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _ROOT)
sys.path.insert(0, os.path.join(_ROOT, "tests"))

from compass_metrics import (  # noqa: E402
    SEED_CVAR_FLOOR,
    SEED_DD_CEILING,
    cvar_95,
    evaluate_compass,
    max_drawdown_frac,
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


def _seeded_thresholds():
    """The level-0 thresholds actually in trainer.db (falls back to SEED_* if
    the DB isn't reachable, so the test still runs standalone)."""
    try:
        from lib.trainer_db import get_connection
        c = get_connection()
        row = c.execute(
            "SELECT dd_ceiling, cvar_floor FROM compass_weights WHERE level_id = 0"
        ).fetchone()
        c.close()
        if row is not None:
            return {"dd_ceiling": float(row[0]), "cvar_floor": float(row[1]), "source": "db"}
    except Exception:
        pass
    return {"dd_ceiling": SEED_DD_CEILING, "cvar_floor": SEED_CVAR_FLOOR, "source": "seed"}


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
    for fn in ALL:
        fn()
    print("ALL PHASE-3 TESTS PASS")
