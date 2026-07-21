#!/usr/bin/env python3
"""Phase-1 unit tests for compass_metrics — EXTRACTION EQUIVALENCE + new metrics.

Proves the public cvar_95 / sortino / max_drawdown are faithful re-implementations
of their private VM sources (12_financial_analytics._cvar / ._sortino,
hedging.max_drawdown) by computing BOTH here and asserting equality — the private
originals are re-declared verbatim as `_ref_*` reference implementations.

Dependency-free: run `python3 tests/test_compass_metrics.py` (asserts + a __main__
runner). Also pytest-compatible (`def test_*`) for when pytest lands.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from compass_metrics import (  # noqa: E402
    FEE_BPS_ROUNDTRIP,
    cvar_95,
    max_drawdown,
    max_drawdown_frac,
    n_eff_bets,
    per_eff_bet_net,
    sortino,
)


# --------------------------------------------------------------------------
# Reference implementations — VERBATIM copies of the private VM originals
# (12_financial_analytics.py:110/228/258, hedging.py:303). If the public
# extraction ever drifts, these assertions fail.
# --------------------------------------------------------------------------
def _ref_mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


def _ref_sortino(daily, ann=365):
    if len(daily) < 3:
        return None
    m = _ref_mean(daily)
    downs = [x for x in daily if x < 0]
    if not downs:
        return 99.0 if m > 0 else None
    dd = (sum(x * x for x in downs) / len(daily)) ** 0.5
    if dd == 0:
        return 0.0
    return (m / dd) * (ann ** 0.5)


def _ref_cvar(xs, pct=0.05):
    if len(xs) < 5:
        return None
    s = sorted(xs)
    cutoff = max(1, int(len(s) * pct))
    return _ref_mean(s[:cutoff])


def _ref_max_drawdown(series):
    peak = None
    worst = 0.0
    for _, value in series:
        if peak is None or value > peak:
            peak = value
        decline = peak - value
        if decline > worst:
            worst = decline
    return worst


def _approx(a, b, tol=1e-9):
    if a is None or b is None:
        return a is b or a == b
    return abs(a - b) <= tol


# --------------------------------------------------------------------------
# cvar_95 extraction equivalence
# --------------------------------------------------------------------------
def test_cvar_matches_reference():
    cases = [
        [-5.0, -3.0, -1.0, 0.0, 1.0, 2.0, 3.0, 4.0, 5.0],
        [-0.42, -0.11, -0.03, 0.0, 0.01, 0.02, 0.05, 0.09, 0.10, 0.20],
        list(range(-30, 30)),
        [-1.0, -1.0, -1.0, -1.0, -1.0],  # exactly 5, cutoff = max(1, int(5*.05)) = 1
    ]
    for xs in cases:
        assert _approx(cvar_95(xs), _ref_cvar(xs)), f"cvar mismatch on {xs[:4]}..."
    # < 5 obs -> None (guard)
    assert cvar_95([1.0, 2.0, 3.0, 4.0]) is None
    assert cvar_95([]) is None
    # cutoff walks: 20 obs, pct .05 -> int(1.0)=1 -> worst single
    twenty = [float(i) for i in range(-10, 10)]
    assert _approx(cvar_95(twenty), min(twenty))
    print("  cvar_95 extraction equivalence: PASS")


# --------------------------------------------------------------------------
# sortino extraction equivalence
# --------------------------------------------------------------------------
def test_sortino_matches_reference():
    cases = [
        [0.01, -0.02, 0.03, -0.01, 0.02],
        [-0.05, 0.10, -0.02, 0.04, -0.01, 0.03, 0.02],
        [0.01, 0.02, 0.03],                 # no downside, m>0 -> 99.0 sentinel
        [-0.01, -0.02, -0.03],              # all down, m<0
        [0.0, 0.0, 0.0, 0.0],               # zero series
    ]
    for xs in cases:
        got, ref = sortino(xs), _ref_sortino(xs)
        assert _approx(got, ref), f"sortino mismatch on {xs}: {got} != {ref}"
    # no-downside sentinel
    assert sortino([0.01, 0.02, 0.03]) == 99.0
    # < 3 obs -> None
    assert sortino([0.01, 0.02]) is None
    assert sortino([]) is None
    print("  sortino extraction equivalence: PASS")


# --------------------------------------------------------------------------
# max_drawdown extraction equivalence (faithful USD magnitude)
# --------------------------------------------------------------------------
def test_max_drawdown_matches_reference():
    from datetime import datetime, timedelta

    def mk(values):
        base = datetime(2025, 1, 1)
        return [(base + timedelta(days=i), v) for i, v in enumerate(values)]

    cases = [
        [100.0, 120.0, 90.0, 110.0, 80.0, 130.0],  # worst = 120-80 = 40
        [50.0, 55.0, 60.0, 65.0],                   # monotonic up -> 0.0
        [100.0, 100.0, 100.0],                      # flat -> 0.0
        [100.0, 50.0],                              # -> 50
    ]
    for values in cases:
        series = mk(values)
        assert _approx(max_drawdown(series), _ref_max_drawdown(series)), values
    # explicit
    assert _approx(max_drawdown(mk([100.0, 120.0, 90.0, 110.0, 80.0, 130.0])), 40.0)
    print("  max_drawdown extraction equivalence: PASS")


# --------------------------------------------------------------------------
# max_drawdown_frac — scale-invariant gate (a) input
# --------------------------------------------------------------------------
def test_max_drawdown_frac():
    # peak 120 -> trough 80 => (120-80)/120 = 0.3333...
    assert _approx(max_drawdown_frac([100, 120, 90, 110, 80, 130]), 40.0 / 120.0)
    # scale-invariance: multiply the whole curve by 1000 -> same fraction
    assert _approx(
        max_drawdown_frac([100, 120, 90, 110, 80, 130]),
        max_drawdown_frac([100000, 120000, 90000, 110000, 80000, 130000]),
    )
    assert _approx(max_drawdown_frac([50, 55, 60]), 0.0)   # monotonic up
    assert _approx(max_drawdown_frac([]), 0.0)
    # accepts (ts, value) pairs too
    from datetime import datetime, timedelta
    b = datetime(2025, 1, 1)
    pairs = [(b + timedelta(days=i), v) for i, v in enumerate([100, 80])]
    assert _approx(max_drawdown_frac(pairs), 0.2)
    print("  max_drawdown_frac scale-invariant: PASS")


# --------------------------------------------------------------------------
# n_eff_bets — 1/HHI
# --------------------------------------------------------------------------
def test_n_eff_bets():
    assert _approx(n_eff_bets([1, 1, 1, 1]), 4.0)              # equal 4 -> 4.0
    assert _approx(n_eff_bets([1]), 1.0)                       # single -> 1.0
    assert _approx(n_eff_bets([1, 0, 0, 0]), 1.0)              # all one ticker
    assert _approx(n_eff_bets({"BTC": 25, "ETH": 25, "SOL": 25, "HYPE": 25}), 4.0)
    # concentrated: 90/10 -> 1/(0.81+0.01) = 1/0.82 ~= 1.2195
    assert _approx(n_eff_bets([90, 10]), 1.0 / (0.81 + 0.01))
    # degenerate -> 1.0 floor
    assert _approx(n_eff_bets([]), 1.0)
    assert _approx(n_eff_bets([0, 0]), 1.0)
    assert _approx(n_eff_bets({"BTC": 0.0}), 1.0)
    print("  n_eff_bets 1/HHI: PASS")


# --------------------------------------------------------------------------
# per_eff_bet_net — net-of-cost, skip+count uncharged, never $0
# --------------------------------------------------------------------------
def test_per_eff_bet_net_skips_uncharged():
    cost_bps = FEE_BPS_ROUNDTRIP / 1e4
    trades = [
        {"pnl_usd": 10.0, "original_notional_usd": 1000.0, "ticker": "BTC"},
        {"pnl_usd": 20.0, "original_notional_usd": 1000.0, "ticker": "ETH"},
        {"pnl_usd": 5.0, "original_notional_usd": None, "ticker": "SOL"},   # skip
        {"pnl_usd": 7.0, "original_notional_usd": 0.0, "ticker": "XRP"},     # skip (<=0)
        {"pnl_usd": None, "original_notional_usd": 1000.0, "ticker": "DOGE"},  # skip (no pnl)
    ]
    r = per_eff_bet_net(trades)
    # 3 skipped, 2 charged, NONE coerced to $0
    assert r.n_skipped_uncharged == 3, r
    assert r.n_charged == 2, r
    # charged nets: (10 - 1000*bps) + (20 - 1000*bps)
    expected_net = (10.0 - 1000.0 * cost_bps) + (20.0 - 1000.0 * cost_bps)
    assert _approx(r.total_net, expected_net), r
    # two equal-notional distinct tickers -> n_eff_bets == 2.0
    assert _approx(r.n_eff_bets, 2.0), r
    assert _approx(r.value, expected_net / 2.0), r
    print("  per_eff_bet_net skip+count (never $0): PASS")


def test_per_eff_bet_net_edges():
    # all-None batch -> value 0.0, eff 1.0, everything skipped
    r = per_eff_bet_net([
        {"pnl_usd": 1.0, "original_notional_usd": None},
        {"pnl_usd": 2.0, "original_notional_usd": -5.0},
    ])
    assert r.n_charged == 0 and r.n_skipped_uncharged == 2
    assert _approx(r.value, 0.0) and _approx(r.n_eff_bets, 1.0)
    # empty batch
    r0 = per_eff_bet_net([])
    assert r0.n_charged == 0 and _approx(r0.value, 0.0) and _approx(r0.n_eff_bets, 1.0)
    # single-trade window -> eff 1.0, value == that trade's net
    cost_bps = FEE_BPS_ROUNDTRIP / 1e4
    r1 = per_eff_bet_net([{"pnl_usd": 12.0, "original_notional_usd": 2000.0, "ticker": "BTC"}])
    assert _approx(r1.n_eff_bets, 1.0)
    assert _approx(r1.value, 12.0 - 2000.0 * cost_bps)
    print("  per_eff_bet_net edge cases: PASS")


ALL = [
    test_cvar_matches_reference,
    test_sortino_matches_reference,
    test_max_drawdown_matches_reference,
    test_max_drawdown_frac,
    test_n_eff_bets,
    test_per_eff_bet_net_skips_uncharged,
    test_per_eff_bet_net_edges,
]


if __name__ == "__main__":
    print("=== Phase-1 compass_metrics extraction-equivalence tests ===")
    for fn in ALL:
        fn()
    print("ALL PHASE-1 TESTS PASS")
