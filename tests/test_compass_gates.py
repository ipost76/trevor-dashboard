#!/usr/bin/env python3
"""Phase-2 tests for the survival WALL + fixed-order/learned-blend scoring.

Proves: the two-gate AND (DD ceiling ∧ CVaR floor), the WALL short-circuit
(survived=False => NO consistency/magnitude computed), and the fixed-order code
invariant (magnitude can NEVER outrank consistency — a learned inversion is
clamped). DB-free (weights injected); the compass_weights seed is verified
separately (seed script in Phase 2 / fixture in Phase 3).

Dependency-free: `python3 tests/test_compass_gates.py`. pytest-compatible too.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import contextlib  # noqa: E402

from compass_metrics import (  # noqa: E402
    evaluate_compass,
    survival_gates,
    _enforce_fixed_order,
    COMPASS_COHERENCE_V2_ENV,
)


@contextlib.contextmanager
def _flag_off():
    """RF3T2-B3: pin COMPASS_COHERENCE_V2_ENABLED OFF for the v1 fixtures, and
    restore whatever was there before. The flag already defaults OFF — this stops
    a fixture from silently passing for the wrong reason if the env is set."""
    prev = os.environ.pop(COMPASS_COHERENCE_V2_ENV, None)
    try:
        yield
    finally:
        if prev is not None:
            os.environ[COMPASS_COHERENCE_V2_ENV] = prev

# Injected level-0-style thresholds/weights so the tests never touch the DB.
W = {"w_consistency": 0.7, "w_magnitude": 0.3, "dd_ceiling": 0.35, "cvar_floor": -0.15}
THR = {"dd_ceiling": 0.35, "cvar_floor": -0.15}

# A healthy per-period net series whose worst-5% mean clears the -0.15 floor.
GOOD_PNL = [0.02] * 19 + [-0.10]          # 20 obs, worst-1 = -0.10 >= -0.15 -> PASS
# A cascade-tail series whose worst-5% mean breaches the floor.
BAD_PNL = [0.01] * 19 + [-0.42]           # 20 obs, worst-1 = -0.42 < -0.15 -> FAIL
# Equity curves.
SHALLOW_EQUITY = [100, 102, 99, 103, 101, 105]        # dd ~ (103-99)/103 = 0.039 -> PASS
DEEP_EQUITY = [100, 120, 60, 80, 55, 70]              # dd = (120-55)/120 = 0.54 -> FAIL

DAILY = [0.01, -0.02, 0.03, -0.01, 0.02, -0.015, 0.025]
TRADES = [
    {"pnl_usd": 10.0, "original_notional_usd": 1000.0, "ticker": "BTC"},
    {"pnl_usd": 8.0, "original_notional_usd": 1000.0, "ticker": "ETH"},
]


def _survivor():
    return {"equity_curve": SHALLOW_EQUITY, "net_pnl_series": GOOD_PNL,
            "daily_returns": DAILY, "trades": TRADES}


# --------------------------------------------------------------------------
# survival_gates: each gate rejects independently; the AND is proven
# --------------------------------------------------------------------------
def test_dd_gate_rejects():
    g = survival_gates({"equity_curve": DEEP_EQUITY, "net_pnl_series": GOOD_PNL}, THR)
    assert g["passed"] is False and "dd_ceiling" in g["failing"], g
    print("  survival_gates rejects DD breach: PASS")


def test_cvar_gate_rejects():
    g = survival_gates({"equity_curve": SHALLOW_EQUITY, "net_pnl_series": BAD_PNL}, THR)
    assert g["passed"] is False and "cvar_floor" in g["failing"], g
    print("  survival_gates rejects CVaR breach: PASS")


def test_both_clear_passes():
    g = survival_gates({"equity_curve": SHALLOW_EQUITY, "net_pnl_series": GOOD_PNL}, THR)
    assert g["passed"] is True and g["failing"] == [], g
    print("  survival_gates passes when BOTH clear: PASS")


def test_and_semantics_dd_ok_cvar_fail_rejected():
    # THE AND: passes DD (shallow) but fails CVaR (fat tail) => REJECTED.
    g = survival_gates({"equity_curve": SHALLOW_EQUITY, "net_pnl_series": BAD_PNL}, THR)
    assert g["dd"] <= THR["dd_ceiling"], g          # DD gate WOULD pass alone
    assert g["passed"] is False, g                  # but ANDed with CVaR -> reject
    assert "cvar_floor" in g["failing"] and "dd_ceiling" not in g["failing"], g
    print("  AND semantics (DD ok, CVaR fail -> REJECT): PASS")


def test_insufficient_tail_fails_survival_first():
    # < 5 obs -> cvar None -> conservative FAIL (cannot clear the wall on an
    # unassessable tail).
    g = survival_gates({"equity_curve": SHALLOW_EQUITY, "net_pnl_series": [0.01, 0.02]}, THR)
    assert g["passed"] is False and g["cvar"] is None, g
    assert "cvar_floor(insufficient_tail)" in g["failing"], g
    print("  insufficient tail -> survival-first FAIL: PASS")


# --------------------------------------------------------------------------
# gate (a) FAILS SAFE on an UNASSESSABLE curve (RF3T1-B3) — the symmetric
# survival-first idiom to gate (b). A dd of 0 on ABSENT data is "no data",
# NOT "no drawdown": every degenerate curve REJECTS; a valid curve with a
# genuine zero drawdown still PASSES. (These fixtures carry a PASSING tail so
# any reject is unambiguously due to gate (a).)
# --------------------------------------------------------------------------
def test_gate_a_rejects_missing_curve():
    g = survival_gates({"net_pnl_series": GOOD_PNL}, THR)
    assert g["passed"] is False and g["dd"] is None, g
    assert "dd_ceiling(insufficient_curve)" in g["failing"], g
    print("  gate (a) rejects a MISSING equity curve (fail-safe, not fail-open): PASS")


def test_gate_a_rejects_empty_curve():
    g = survival_gates({"equity_curve": [], "net_pnl_series": GOOD_PNL}, THR)
    assert g["passed"] is False and g["dd"] is None, g
    assert "dd_ceiling(insufficient_curve)" in g["failing"], g
    print("  gate (a) rejects an EMPTY equity curve: PASS")


def test_gate_a_rejects_degenerate_curves():
    # None value, length-1, all-zero, all-NaN -> ALL unassessable -> REJECT, dd None.
    # (The None value used to CRASH with a TypeError; it now rejects cleanly.)
    for label, curve in (
        ("None value", None),
        ("length-1", [100.0]),
        ("all-zero", [0.0, 0.0, 0.0]),
        ("all-NaN", [float("nan"), float("nan")]),
    ):
        g = survival_gates({"equity_curve": curve, "net_pnl_series": GOOD_PNL}, THR)
        assert g["passed"] is False and g["dd"] is None, (label, g)
        assert "dd_ceiling(insufficient_curve)" in g["failing"], (label, g)
    print("  gate (a) rejects None/length-1/all-zero/all-NaN (no crash): PASS")


def test_gate_a_valid_curve_with_zero_drawdown_still_passes():
    # THE CRUX: the fix is NOT "dd == 0 -> reject". A VALID multi-point curve that
    # genuinely never declined is assessed "no drawdown" (dd 0.0) and PASSES.
    g = survival_gates({"equity_curve": [50, 55, 60], "net_pnl_series": GOOD_PNL}, THR)
    assert g["passed"] is True and g["dd"] == 0.0 and g["failing"] == [], g
    # The _DD_MIN_N=2 boundary: a genuine 2-point curve is minimum-assessable, PASSES.
    g2 = survival_gates({"equity_curve": [100, 101], "net_pnl_series": GOOD_PNL}, THR)
    assert g2["passed"] is True and g2["dd"] == 0.0, g2
    print("  gate (a) PASSES a valid curve with a genuine zero drawdown (crux): PASS")


def test_evaluate_compass_rejects_no_curve_at_the_wall():
    # Full path: a candidate with no backtest equity curve is REJECTED at the wall
    # (survived=False), never scored on absent evidence.
    cand = {"net_pnl_series": GOOD_PNL, "daily_returns": DAILY, "trades": TRADES}
    v = evaluate_compass(cand, level=0, weights=W)
    assert v["survived"] is False and v["verdict"] == "rejected", v
    assert v["consistency"] is None and v["magnitude"] is None, v
    assert "dd_ceiling(insufficient_curve)" in v["failing_gates"], v
    print("  evaluate_compass rejects a curve-less candidate at the wall: PASS")


# --------------------------------------------------------------------------
# evaluate_compass: the WALL short-circuits (no consistency/magnitude on fail)
# --------------------------------------------------------------------------
def test_wall_shortcircuits_no_scoring():
    rejected = {"equity_curve": DEEP_EQUITY, "net_pnl_series": BAD_PNL,
                "daily_returns": DAILY, "trades": TRADES}
    v = evaluate_compass(rejected, level=0, weights=W)
    assert v["survived"] is False, v
    assert v["consistency"] is None, "WALL must NOT compute consistency on reject"
    assert v["magnitude"] is None, "WALL must NOT compute magnitude on reject"
    assert v["blend_score"] is None and v["verdict"] == "rejected", v
    assert v["failing_gates"], v
    print("  WALL short-circuit (no consistency/magnitude on reject): PASS")


def test_survivor_is_scored():
    # RF3T2-B3: this asserts the **v1** blend explicitly. The flag defaults OFF,
    # but pin it so the fixture can never silently start testing v2 (a fixture
    # that passes for the wrong reason is worse than one that fails).
    with _flag_off():
        v = evaluate_compass(_survivor(), level=0, weights=W)
        assert v["survived"] is True and v["verdict"] == "scored", v
        assert v["consistency"] is not None and v["magnitude"] is not None, v
        assert v["blend_score"] is not None, v
        # v1 blend = 0.7*consistency + 0.3*magnitude (raw linear sum)
        exp = 0.7 * v["consistency"] + 0.3 * v["magnitude"]
        assert abs(v["blend_score"] - exp) < 1e-9, v
        assert v["coherence"]["blend_version"] == "v1", v
    print("  survivor scored (v1 blend = wc*consist + wm*mag): PASS")


# --------------------------------------------------------------------------
# fixed-order invariant: magnitude can NEVER outrank consistency
# --------------------------------------------------------------------------
def test_fixed_order_clamps_inversion():
    # Helper-level: a learned inversion is clamped.
    wc, wm, clamped = _enforce_fixed_order(0.3, 0.7)
    assert clamped is True and wc == 0.3 and wm == 0.3, (wc, wm, clamped)
    # Non-inverted passes through untouched.
    wc2, wm2, c2 = _enforce_fixed_order(0.7, 0.3)
    assert c2 is False and wc2 == 0.7 and wm2 == 0.3
    print("  _enforce_fixed_order clamps inversion: PASS")


def test_evaluate_clamps_inverted_weights():
    # End-to-end: try to make magnitude outrank consistency via weights -> clamped.
    inverted = {"w_consistency": 0.3, "w_magnitude": 0.7, "dd_ceiling": 0.35, "cvar_floor": -0.15}
    with _flag_off():  # RF3T2-B3: pinned to the v1 path (see test_survivor_is_scored)
        v = evaluate_compass(_survivor(), level=0, weights=inverted)
        assert v["weights_used"]["clamped"] is True, v
        assert v["weights_used"]["w_magnitude"] == v["weights_used"]["w_consistency"] == 0.3, v
        # blend used the CLAMPED weights (0.3/0.3), NOT the inverted 0.7 on magnitude.
        exp = 0.3 * v["consistency"] + 0.3 * v["magnitude"]
        assert abs(v["blend_score"] - exp) < 1e-9, v
    print("  evaluate_compass clamps inverted weights (mag never outranks): PASS")


def test_survived_unscorable_when_sortino_insufficient():
    # Survives the wall but daily_returns has < 3 obs -> sortino None -> unscorable.
    cand = {"equity_curve": SHALLOW_EQUITY, "net_pnl_series": GOOD_PNL,
            "daily_returns": [0.01, 0.02], "trades": TRADES}
    v = evaluate_compass(cand, level=0, weights=W)
    assert v["survived"] is True and v["verdict"] == "survived_unscorable", v
    assert v["consistency"] is None and v["blend_score"] is None, v
    # magnitude WAS computed (it survived) — only the blend is withheld.
    assert v["magnitude"] is not None, v
    print("  survived-but-unscorable (sortino < 3 obs): PASS")


# ═══════════════════════════════════════════════════════════════════════════
# RD-B8 — WEIGHT FINITENESS (the cfg_float-class gap on the compass flow)
#
# Before RD-B8 these were bare ``float(row[N])`` with no guard. MEASURED surface:
#   * caller ``weights=`` NaN   -> uncaught AssertionError in _enforce_fixed_order
#                                  (NaN comparisons are all False) — v1 AND v2
#   * caller ``weights=`` +-inf -> v1 non-finite blend_score; v2 absorbed it
#   * DB NaN   -> SQLite stores NaN as NULL -> float(None) -> TypeError
#   * DB +-inf -> round-tripped -> non-finite blend_score, silently
# RD-B1 closes cfg_float at the root ON THE VM and does not reach WSL, so this is
# guarded here. Every path must now degrade to the seed weight with a log.
# ═══════════════════════════════════════════════════════════════════════════
def _bad_weight_variants():
    return [("NaN", float("nan")), ("+inf", float("inf")), ("-inf", float("-inf")),
            ("None", None), ("str", "abc")]


def test_rd_b8_caller_weights_finiteness_guarded():
    """A non-finite caller-supplied weight must NEVER raise and must NEVER
    produce a non-finite blend_score — in either blend version."""
    import math
    for label, bad in _bad_weight_variants():
        for flag_on in (False, True):
            prev = os.environ.pop(COMPASS_COHERENCE_V2_ENV, None)
            if flag_on:
                os.environ[COMPASS_COHERENCE_V2_ENV] = "true"
            try:
                bad_w = dict(W)
                bad_w["w_consistency"] = bad
                v = evaluate_compass(_survivor(), 0, weights=bad_w)
                blend = v.get("blend_score")
                assert v.get("verdict") in ("scored", "survived_unscorable", "rejected"), v
                if isinstance(blend, float):
                    assert math.isfinite(blend), (label, flag_on, blend)
            finally:
                os.environ.pop(COMPASS_COHERENCE_V2_ENV, None)
                if prev is not None:
                    os.environ[COMPASS_COHERENCE_V2_ENV] = prev
    print("  RD-B8 caller weights= finiteness-guarded "
          "(NaN/+-inf/None/str x v1,v2 -> no raise, finite blend): PASS")


def test_rd_b8_db_weights_finiteness_guarded():
    """The DB read path must degrade to the seed weights, not raise.

    ⚠️ NaN is written but SQLite stores it as NULL — that is exactly why a bare
    ``float(row[N])`` raised TypeError rather than the AssertionError the caller
    path produced. Both are covered by the same guard."""
    import math
    import sqlite3
    import tempfile
    from compass_metrics import _read_compass_weights
    for label, bad in [("NaN", float("nan")), ("+inf", float("inf")),
                       ("-inf", float("-inf")), ("None", None)]:
        with tempfile.TemporaryDirectory() as d:
            conn = sqlite3.connect(os.path.join(d, "t.db"))
            conn.execute(
                "CREATE TABLE compass_weights (level_id INTEGER PRIMARY KEY, "
                "w_consistency REAL, w_magnitude REAL, dd_ceiling REAL, "
                "cvar_floor REAL, learned INTEGER)")
            conn.execute("INSERT INTO compass_weights VALUES (0,?,0.3,0.35,-0.15,0)", (bad,))
            conn.commit()
            w = _read_compass_weights(conn, 0)
            assert math.isfinite(float(w["w_consistency"])), (label, w)
            with _flag_off():
                v = evaluate_compass(_survivor(), 0, conn=conn)
            blend = v.get("blend_score")
            if isinstance(blend, float):
                assert math.isfinite(blend), (label, blend)
            conn.close()
    print("  RD-B8 DB weights finiteness-guarded "
          "(NaN->NULL/+-inf/None -> seed fallback, finite blend): PASS")


def test_rd_b8_valid_weights_pass_through_unchanged():
    """The guard must be a NO-OP on healthy weights — a fix that silently moved a
    valid weight would be worse than the defect."""
    from compass_metrics import _sanitize_weights
    out = _sanitize_weights(dict(W), "test")
    for key, val in W.items():
        assert out[key] == val, (key, val, out[key])
    print("  RD-B8 finiteness guard is a no-op on valid weights: PASS")


ALL = [
    test_dd_gate_rejects,
    test_cvar_gate_rejects,
    test_both_clear_passes,
    test_and_semantics_dd_ok_cvar_fail_rejected,
    test_insufficient_tail_fails_survival_first,
    test_gate_a_rejects_missing_curve,
    test_gate_a_rejects_empty_curve,
    test_gate_a_rejects_degenerate_curves,
    test_gate_a_valid_curve_with_zero_drawdown_still_passes,
    test_evaluate_compass_rejects_no_curve_at_the_wall,
    test_wall_shortcircuits_no_scoring,
    test_survivor_is_scored,
    test_fixed_order_clamps_inversion,
    test_evaluate_clamps_inverted_weights,
    test_survived_unscorable_when_sortino_insufficient,
    # RD-B8 weight finiteness (cfg_float-class gap on the compass flow)
    test_rd_b8_caller_weights_finiteness_guarded,
    test_rd_b8_db_weights_finiteness_guarded,
    test_rd_b8_valid_weights_pass_through_unchanged,
]


if __name__ == "__main__":
    print("=== Phase-2 survival-wall + fixed-order-blend tests ===")
    for fn in ALL:
        fn()
    print("ALL PHASE-2 TESTS PASS")
