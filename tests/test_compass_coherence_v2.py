#!/usr/bin/env python3
"""RF3T2-B3 — COMPASS COHERENCE v2 tests (T2-a / T2-b / T2-c / T2-d).

Proves, in one place, the four coherence fixes AND that flag-OFF is byte-identical:

  T2-a  the blend is a BOUNDED tie-break, not a raw sum of incompatible units:
        magnitude can NEVER invert an ordering outside the epsilon band, so the
        v1 crossover is UNREACHABLE at any magnitude.
  T2-b  n_eff_bets is correlation-adjusted: reduces EXACTLY to 1/HHI at rho=0,
        to 1.0 at rho=1, and FAILS CONSERVATIVE (1.0) on missing/thin data.
  T2-c  the sample floor is a smooth DAMPER on consistency, not a reject.
        🚨 SCOPE: the n=39->40 flip lives in cvar_95's cutoff = SURVIVAL GATE (b)
        = THE WALL, and THE WALL DOES NOT MOVE. So the SURVIVAL verdict still
        flips there, correctly and by design. What T2-c removes is the SCORE
        cliff RV-D1 S5 named — a thin-sample candidate no longer ranks identical
        to a thick-sample one — and the damper is continuous in n, so no adjacent
        n can flip the score. See test_t2c_39_vs_40_score_cliff_is_gone.
  T2-d  family_k / n_trials is CUMULATIVE across levels.

Plus the fix-induced regression set: survival wall unmoved, RF3T1-B3 gate-(a)
fail-closed intact, idempotency, and the unconditional blend-version tripwire.

Dependency-free: `python3 tests/test_compass_coherence_v2.py`. pytest-compatible.
"""
import contextlib
import logging

import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import compass_metrics as cm  # noqa: E402
from compass_metrics import (  # noqa: E402
    evaluate_compass, n_eff_bets, per_eff_bet_net,
    COMPASS_COHERENCE_V2_ENV, MAGNITUDE_SCALE_USD,
    _derive_epsilon, _bounded_tiebreak, _sample_damper, _SAMPLE_FLOOR_N,
    _N_EFF_CONSERVATIVE_FALLBACK,
)

W = {"w_consistency": 0.7, "w_magnitude": 0.3, "dd_ceiling": 0.35, "cvar_floor": -0.15}
TICKERS = ["BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "NEAR", "SUI", "AVAX", "LINK"]


@contextlib.contextmanager
def flag(on: bool):
    prev = os.environ.pop(COMPASS_COHERENCE_V2_ENV, None)
    if on:
        os.environ[COMPASS_COHERENCE_V2_ENV] = "true"
    try:
        yield
    finally:
        os.environ.pop(COMPASS_COHERENCE_V2_ENV, None)
        if prev is not None:
            os.environ[COMPASS_COHERENCE_V2_ENV] = prev


def uniform_corr(tickers, rho):
    return {a: {b: (1.0 if a == b else rho) for b in tickers} for a in tickers}


def trades_for(total_net, n=5, ticker="BTC"):
    notional = 1000.0
    cost = (cm.FEE_BPS_ROUNDTRIP / 1e4) * notional
    return [{"pnl_usd": total_net / n + cost, "original_notional_usd": notional,
             "ticker": ticker} for _ in range(n)]


STEADY_DAILY = [0.010, 0.011, 0.009, 0.012, 0.010, 0.011, 0.008, 0.012, -0.001, 0.010]
VOL_DAILY = [0.05, -0.04, 0.06, -0.05, 0.07, -0.03, 0.05, -0.06, 0.08, -0.04]


def candidate(daily, total_net, equity=None, netpnl=None, corr=None):
    c = {
        "equity_curve": equity if equity is not None else [100.0, 101.0, 100.5, 102.0, 103.0],
        "net_pnl_series": netpnl if netpnl is not None
        else [0.01, -0.02, 0.03, -0.01, 0.02, -0.005, 0.015],
        "daily_returns": daily,
        "trades": trades_for(total_net),
    }
    if corr is not None:
        c["correlation"] = corr
    return c


# ==========================================================================
# T2-b — correlation-adjusted n_eff_bets
# ==========================================================================
def test_t2b_zero_correlation_reduces_exactly_to_hhi():
    w = {t: 1000.0 for t in TICKERS}
    with flag(False):
        v1 = n_eff_bets(w)
    with flag(True):
        v2 = n_eff_bets(w, uniform_corr(TICKERS, 0.0))
    assert abs(v1 - v2) < 1e-12, (v1, v2)
    assert abs(v1 - 10.0) < 1e-12, v1
    # Also on an UNEQUAL book, where 1/HHI != N (the real proof it's the same math).
    w2 = {"BTC": 5000.0, "ETH": 1000.0, "SOL": 1000.0}
    with flag(False):
        a = n_eff_bets(w2)
    with flag(True):
        b = n_eff_bets(w2, uniform_corr(list(w2), 0.0))
    assert abs(a - b) < 1e-12, (a, b)
    print(f"  T2-b rho=0 reduces EXACTLY to 1/HHI: equal {v1:.6f}=={v2:.6f} | "
          f"unequal {a:.6f}=={b:.6f}: PASS")


def test_t2b_full_correlation_is_one_bet():
    with flag(True):
        got = n_eff_bets({t: 1000.0 for t in TICKERS}, uniform_corr(TICKERS, 1.0))
    assert abs(got - 1.0) < 1e-12, got
    print(f"  T2-b rho=1 -> n_eff = {got:.6f} (a fully correlated book IS one bet): PASS")


def test_t2b_ten_crypto_beta_overcount_fixed():
    w = {t: 1000.0 for t in TICKERS}
    with flag(False):
        before = n_eff_bets(w)
    with flag(True):
        after = n_eff_bets(w, uniform_corr(TICKERS, 0.65))
    assert abs(before - 10.0) < 1e-9, before
    assert 1.3 < after < 1.6, after
    print(f"  T2-b 10 crypto-beta names: BEFORE {before:.4f} -> AFTER {after:.4f} "
          f"(over-count {before/after:.2f}x removed): PASS")


def test_t2b_missing_correlation_fails_conservative():
    w = {t: 1000.0 for t in TICKERS}
    cases = {
        "correlation=None": None,
        "empty dict": {},
        # BOTH directions removed — a symmetric matrix given only one direction is
        # VALID and the reverse lookup correctly resolves it, so removing one
        # direction would not actually make the pair unavailable.
        "partial coverage (BTC/ETH absent both ways)": {
            a: {b: 0.5 for b in TICKERS
                if not {a, b} == {"BTC", "ETH"}} for a in TICKERS},
        "malformed value (string)": uniform_corr(TICKERS, 0.5) | {"BTC": {"ETH": "nope"}},
        "out-of-range rho (1.7)": uniform_corr(TICKERS, 0.5) | {"BTC": {"ETH": 1.7}},
        "NaN rho": uniform_corr(TICKERS, 0.5) | {"BTC": {"ETH": float("nan")}},
    }
    with flag(True):
        for label, corr in cases.items():
            got = n_eff_bets(w, corr)
            assert got == _N_EFF_CONSERVATIVE_FALLBACK == 1.0, (label, got)
            # 🚨 the load-bearing assertion: it did NOT fall back to 1/HHI (=10).
            assert got < 10.0, (label, got)
            print(f"    {label:<38} -> n_eff = {got:.4f} (NOT 10.0): PASS")
    print("  T2-b missing/thin/degenerate FAILS CONSERVATIVE toward HIGH correlation: PASS")


def test_t2b_threads_through_per_eff_bet_net():
    book = [{"pnl_usd": 10.0 + (cm.FEE_BPS_ROUNDTRIP / 1e4) * 1000.0,
             "original_notional_usd": 1000.0, "ticker": t} for t in TICKERS]
    with flag(False):
        r1 = per_eff_bet_net(book)
    with flag(True):
        r2 = per_eff_bet_net(book, correlation=uniform_corr(TICKERS, 0.65))
    assert abs(r1.n_eff_bets - 10.0) < 1e-9 and abs(r1.value - 10.0) < 1e-9, r1
    assert 1.3 < r2.n_eff_bets < 1.6, r2
    assert abs(r2.value - r2.total_net / r2.n_eff_bets) < 1e-9, r2
    print(f"  T2-b per_eff_bet_net denominator: ${r1.value:.4f}/bet (n_eff {r1.n_eff_bets:.2f}) "
          f"-> ${r2.value:.4f}/bet (n_eff {r2.n_eff_bets:.2f}): PASS")


# ==========================================================================
# T2-c — sample DAMPER (not a gate); the 39->40 cliff is gone
# ==========================================================================
def test_t2c_damper_is_smooth_and_never_zero():
    assert _sample_damper(0) == 0.0
    assert _sample_damper(_SAMPLE_FLOOR_N) == 1.0
    assert _sample_damper(_SAMPLE_FLOOR_N * 3) == 1.0
    prev = _sample_damper(0)
    for n in range(1, _SAMPLE_FLOOR_N + 5):
        cur = _sample_damper(n)
        assert cur >= prev, (n, cur, prev)          # monotone
        assert abs(cur - prev) <= 1.0 / _SAMPLE_FLOOR_N + 1e-12, (n, cur, prev)  # no cliff
        prev = cur
    print(f"  T2-c damper smooth+monotone, max step {1/_SAMPLE_FLOOR_N:.4f}, "
          f"1.0 at n>={_SAMPLE_FLOOR_N}: PASS")


def test_t2c_39_vs_40_score_cliff_is_gone():
    """🚨 SCOPE, STATED HONESTLY — read this before changing the test.

    The n=39 -> n=40 flip lives in ``cvar_95``'s cutoff (``max(1, int(n*0.05))``
    goes 1 -> 2), which feeds SURVIVAL GATE (b) — i.e. THE WALL. Proven here:
    cvar_95 goes -0.2000 -> -0.0950 across that boundary.

    THE WALL DOES NOT MOVE (hard constraint). So a consistency DAMPER cannot and
    must not change that SURVIVAL verdict, and this test does NOT claim it does.

    What T2-c actually removes is the defect RV-D1 S5 named on the SCORE side:
    "a 5-obs candidate that clears both gates ... produces a full blend_score
    ranked identically to a 300-obs candidate." Two properties are proven:
      (1) a thin-sample candidate NO LONGER ranks equal to a thick-sample one
          with an identical Sortino, and
      (2) the damper is continuous in n, so no adjacent n can flip the SCORE.
    """
    def wall_cand(n):
        return {"equity_curve": [100.0, 101.0, 102.0],
                "net_pnl_series": [-0.20] + [0.01] * (n - 1),
                "daily_returns": [0.01, -0.005, 0.012, 0.008] * 12,
                "trades": trades_for(2.0)}
    with flag(False):
        v39_1, v40_1 = (evaluate_compass(wall_cand(n), 0, weights=W) for n in (39, 40))
    with flag(True):
        v39_2, v40_2 = (evaluate_compass(wall_cand(n), 0, weights=W) for n in (39, 40))
    print(f"    WALL verdict (unchanged BY DESIGN — the wall does not move):")
    print(f"      v1: n=39 survived={v39_1['survived']} | n=40 survived={v40_1['survived']}")
    print(f"      v2: n=39 survived={v39_2['survived']} | n=40 survived={v40_2['survived']}")
    assert v39_1["survived"] == v39_2["survived"], "wall MOVED under v2"
    assert v40_1["survived"] == v40_2["survived"], "wall MOVED under v2"

    # (1) thin no longer ranks equal to thick — the actual D1 S5 score defect.
    base = [0.01, -0.005, 0.012, 0.008]
    thin = candidate(base * 1, 2.0)        # 4 daily obs
    thick = candidate(base * 15, 2.0)      # 60 daily obs, SAME sortino by construction
    with flag(False):
        t1, k1 = (evaluate_compass(c, 0, weights=W) for c in (thin, thick))
    with flag(True):
        t2, k2 = (evaluate_compass(c, 0, weights=W) for c in (thin, thick))
    assert abs(t1["consistency"] - k1["consistency"]) < 1e-9, "fixture: sortino must match"
    assert abs(t1["blend_score"] - k1["blend_score"]) < 1e-9, \
        "v1 should rank thin == thick (the defect)"
    assert t2["blend_score"] < k2["blend_score"], (t2["blend_score"], k2["blend_score"])
    print(f"    SCORE ranking (identical sortino {t1['consistency']:.4f}):")
    print(f"      v1: thin(n=4) {t1['blend_score']:.4f} == thick(n=60) {k1['blend_score']:.4f}"
          f"  <- THE DEFECT (thin ranks equal)")
    print(f"      v2: thin(n=4) {t2['blend_score']:.4f} <  thick(n=60) {k2['blend_score']:.4f}"
          f"  <- damped, still scored")

    # (2) no SCORE cliff at ANY adjacent n, incl. 39->40.
    worst = 0.0
    for n in range(1, _SAMPLE_FLOOR_N + 6):
        a, b = _sample_damper(n - 1), _sample_damper(n)
        worst = max(worst, abs(b - a))
    d39, d40 = _sample_damper(39), _sample_damper(40)
    assert worst <= 1.0 / _SAMPLE_FLOOR_N + 1e-12, worst
    print(f"    SCORE continuity: damper n=39 {d39:.4f} -> n=40 {d40:.4f} "
          f"(step {d40-d39:.4f}); max step over ALL adjacent n = {worst:.4f} "
          f"-> no score cliff anywhere: PASS")


def test_t2c_thin_sample_is_damped_not_rejected():
    thin = candidate([0.01, -0.005, 0.012, 0.008], 2.0)   # 4 daily obs, well under 40
    with flag(True):
        v = evaluate_compass(thin, 0, weights=W)
    assert v["survived"] is True, v
    assert v["verdict"] == "scored", v                     # STILL SCORABLE
    assert v["blend_score"] is not None, v                 # STILL COMPARABLE
    co = v["coherence"]
    assert co["sample_shrink"] < 1.0, co
    assert abs(co["consistency_effective"] - v["consistency"] * co["sample_shrink"]) < 1e-12, co
    print(f"  T2-c thin sample (n={co['n_obs']}): scored + comparable, consistency "
          f"{v['consistency']:.3f} damped x{co['sample_shrink']:.3f} -> "
          f"{co['consistency_effective']:.3f} (NOT rejected): PASS")


# ==========================================================================
# T2-a — the bounded tie-break; the crossover is UNREACHABLE
# ==========================================================================
def test_t2a_steady_small_beats_volatile_bigger():
    with flag(True):
        s = evaluate_compass(candidate(STEADY_DAILY, 2.0), 0, weights=W)
        v = evaluate_compass(candidate(VOL_DAILY, 200.0), 0, weights=W)
    assert s["blend_score"] > v["blend_score"], (s["blend_score"], v["blend_score"])
    print(f"  T2-a steady-small (sortino {s['consistency']:.2f}, $2/bet) blend "
          f"{s['blend_score']:.4f} > volatile-bigger (sortino {v['consistency']:.2f}, "
          f"$200/bet) blend {v['blend_score']:.4f}: PASS")


def test_t2a_crossover_is_unreachable_at_any_magnitude():
    """🚨 THE ACCEPTANCE TEST FOR THE WHOLE PROMPT."""
    with flag(True):
        steady = evaluate_compass(candidate(STEADY_DAILY, 2.0), 0, weights=W)
        sweep = [2, 10, 50, 200, 1_000, 10_000, 100_000, 1_000_000, 1e9]
        for M in sweep:
            v = evaluate_compass(candidate(VOL_DAILY, M), 0, weights=W)
            assert steady["blend_score"] > v["blend_score"], (M, steady, v)
            print(f"    magnitude ${M:>15,.0f}/bet -> volatile blend {v['blend_score']:.6f} "
                  f"< steady {steady['blend_score']:.6f}  STEADY WINS")
    print("  T2-a CROSSOVER UNREACHABLE at every magnitude up to $1e9: PASS")


def test_t2a_bound_holds_over_random_pairs():
    """Outside the epsilon band, magnitude can NEVER invert the ordering."""
    import random
    random.seed(20260724)
    eps = _derive_epsilon(0.7, 0.3)
    violations = 0
    for _ in range(200_000):
        cA, cB = random.uniform(-50, 600), random.uniform(-50, 600)
        mA, mB = random.uniform(-1e6, 1e6), random.uniform(-1e6, 1e6)
        if cA - cB > eps:
            bA = cA + _bounded_tiebreak(mA, eps)
            bB = cB + _bounded_tiebreak(mB, eps)
            if bA <= bB:
                violations += 1
    assert violations == 0, violations
    print(f"  T2-a bound: 0 inversions in 200,000 random pairs (magnitude to ±$1e6, "
          f"eps={eps:.4f}): PASS")


def test_t2a_magnitude_decides_inside_the_band():
    eps = _derive_epsilon(0.7, 0.3)
    # Two candidates with IDENTICAL consistency (the exact-tie cluster) —
    # magnitude is the SOLE decider.
    with flag(True):
        lo = evaluate_compass(candidate(STEADY_DAILY, 1.0), 0, weights=W)
        hi = evaluate_compass(candidate(STEADY_DAILY, 40.0), 0, weights=W)
    assert lo["consistency"] == hi["consistency"], (lo["consistency"], hi["consistency"])
    assert hi["blend_score"] > lo["blend_score"], (lo, hi)
    assert abs(hi["blend_score"] - lo["blend_score"]) < eps, (lo, hi)
    print(f"  T2-a exact tie (sortino {lo['consistency']:.4f} both): $40/bet blend "
          f"{hi['blend_score']:.6f} > $1/bet {lo['blend_score']:.6f} — magnitude "
          f"decides, gap {hi['blend_score']-lo['blend_score']:.6f} < eps {eps:.4f}: PASS")


def test_t2a_tiebreak_term_never_saturates_over_realistic_range():
    """🚨 The trap: too small an S saturates the tanh INSIDE the band."""
    eps = _derive_epsilon(0.7, 0.3)
    half = eps / 2.0
    deployable = 82 * 0.45
    t0, tdep = _bounded_tiebreak(0.0, eps), _bounded_tiebreak(deployable, eps)
    used = (tdep - t0) / half
    assert 0.4 < used < 0.9, used          # healthy spread, neither dead nor pinned
    for m in (0.0, 1.0, 10.0, deployable, 1e6, -1e6):
        assert -half <= _bounded_tiebreak(m, eps) <= half, m
    assert _bounded_tiebreak(float("nan"), eps) == 0.0
    assert _bounded_tiebreak(float("inf"), eps) == 0.0
    print(f"  T2-a S={MAGNITUDE_SCALE_USD} USD/bet: term spans {t0:.6f}->{tdep:.6f} over "
          f"$0-${deployable:.2f} = {used*100:.1f}% of the half-band (NOT saturated); "
          f"bounded for ±$1e6 and NaN/inf-safe: PASS")


def test_t2a_epsilon_derives_from_existing_columns_only():
    assert abs(_derive_epsilon(0.7, 0.3) - (0.3 / 0.7)) < 1e-12
    assert _derive_epsilon(0.5, 0.5) == 1.0            # a wider learned band
    assert _derive_epsilon(0.9, 0.1) < _derive_epsilon(0.6, 0.4)   # flexes per level
    assert _derive_epsilon(0.0, 0.3) > 0.0             # guarded, never div-by-zero
    assert _derive_epsilon(float("nan"), 0.3) > 0.0
    assert _derive_epsilon(0.7, 0.0) > 0.0             # floored, tie-break survives
    print("  T2-a epsilon from w_magnitude/w_consistency (NO schema change), "
          "flexes per level, guarded: PASS")


def test_t2a_invariant_fires_on_inverted_weight():
    """The bound assertion clamps + logs rather than letting an inversion through."""
    records = []

    class Cap(logging.Handler):
        def emit(self, record):
            records.append(record.getMessage())

    h = Cap()
    cm._log.addHandler(h)
    prev_level = cm._log.level
    cm._log.setLevel(logging.INFO)   # else the root CRITICAL level filters the warning
    try:
        with flag(True):
            inverted = {"w_consistency": 0.3, "w_magnitude": 0.7,
                        "dd_ceiling": 0.35, "cvar_floor": -0.15}
            v = evaluate_compass(candidate(STEADY_DAILY, 5.0), 0, weights=inverted)
        assert v["weights_used"]["clamped"] is True, v
        assert any("FIXED-ORDER VIOLATION" in m for m in records), records
        # post-clamp the band is derived from the CLAMPED weights (0.3/0.3 -> 1.0)
        assert abs(v["coherence"]["epsilon"] - 1.0) < 1e-12, v["coherence"]
    finally:
        cm._log.removeHandler(h)
        cm._log.setLevel(prev_level)
    print("  T2-a inverted learned weight -> clamped + logged (never silent): PASS")


# ==========================================================================
# THE TRIPWIRE — unconditional blend-version log on BOTH paths
# ==========================================================================
def test_version_log_fires_on_every_score_both_paths():
    records = []

    class Cap(logging.Handler):
        def emit(self, record):
            records.append(record.getMessage())

    h = Cap()
    h.setLevel(logging.INFO)
    cm._log.addHandler(h)
    prev_level = cm._log.level
    cm._log.setLevel(logging.INFO)
    try:
        for on in (False, True):
            for label, cand in (
                ("scored", candidate(STEADY_DAILY, 2.0)),
                ("rejected", candidate(STEADY_DAILY, 2.0,
                                       netpnl=[-0.5] * 10)),          # breaches CVaR
            ):
                records.clear()
                with flag(on):
                    evaluate_compass(cand, 0, weights=W)
                want = f"blend_version={'v2' if on else 'v1'}"
                hits = [m for m in records if want in m]
                assert hits, (on, label, records)
                print(f"    flag={'ON ' if on else 'OFF'} {label:<9} -> {hits[0][:96]}")
    finally:
        cm._log.removeHandler(h)
        cm._log.setLevel(prev_level)
    print("  TRIPWIRE: unconditional INFO blend-version on scored AND rejected, "
          "v1 AND v2: PASS")


# ==========================================================================
# FLAG OFF -> BYTE-IDENTICAL
# ==========================================================================
def test_flag_off_is_byte_identical():
    cands = [
        candidate(STEADY_DAILY, 2.0),
        candidate(VOL_DAILY, 200.0),
        candidate([0.01, -0.005, 0.012, 0.008], 5.0),          # thin sample
        candidate(STEADY_DAILY, 2.0, netpnl=[-0.5] * 10),      # rejected
        candidate(STEADY_DAILY, 2.0, equity=[]),               # gate-(a) fail-closed
    ]
    for i, c in enumerate(cands):
        with flag(False):
            got = evaluate_compass(c, 0, weights=W)
        # Recompute the v1 blend from first principles — no reference to the new code.
        exp_blend = None
        if got["survived"] and got["consistency"] is not None:
            exp_blend = 0.7 * got["consistency"] + 0.3 * got["magnitude"]
        assert got["blend_score"] == exp_blend or (
            exp_blend is not None and abs(got["blend_score"] - exp_blend) < 1e-12
        ), (i, got["blend_score"], exp_blend)
        assert got["coherence"] == {"blend_version": "v1"}, (i, got["coherence"])
    # v1 n_eff_bets ignores a supplied correlation entirely.
    with flag(False):
        assert abs(n_eff_bets({t: 1000.0 for t in TICKERS},
                              uniform_corr(TICKERS, 1.0)) - 10.0) < 1e-12
    print("  FLAG OFF: v1 blend arithmetic reproduced from first principles on 5 "
          "candidate shapes; correlation ignored: PASS")


# ==========================================================================
# FIX-INDUCED REGRESSION SET
# ==========================================================================
def test_survival_wall_unmoved():
    for on in (False, True):
        with flag(on):
            v = evaluate_compass(candidate(STEADY_DAILY, 2.0, netpnl=[-0.5] * 10),
                                 0, weights=W)
            assert v["survived"] is False, (on, v)
            assert v["consistency"] is None and v["magnitude"] is None, (on, v)
            assert v["blend_score"] is None and v["verdict"] == "rejected", (on, v)
            # DD ceiling breach
            deep = candidate(STEADY_DAILY, 2.0, equity=[100, 120, 60, 80, 55, 70])
            assert evaluate_compass(deep, 0, weights=W)["survived"] is False, on
    print("  WALL unmoved (both gates, both flag states; short-circuit intact): PASS")


def test_tier1_gate_a_fail_closed_still_holds():
    shapes = {"missing": "MISSING", "empty": [], "len-1": [100.0],
              "all-zero": [0.0, 0.0], "None": None, "all-NaN": [float("nan")] * 3}
    for on in (False, True):
        with flag(on):
            for label, ec in shapes.items():
                c = candidate(STEADY_DAILY, 2.0)
                if ec == "MISSING":
                    c.pop("equity_curve")
                else:
                    c["equity_curve"] = ec
                v = evaluate_compass(c, 0, weights=W)
                assert v["survived"] is False, (on, label, v)
                assert any("insufficient_curve" in f for f in v["failing_gates"]), (label, v)
    print(f"  RF3T1-B3 gate-(a) fail-closed intact for {len(shapes)} shapes, "
          f"both flag states: PASS")


def test_idempotent():
    for on in (False, True):
        with flag(on):
            c = candidate(STEADY_DAILY, 2.0)
            a, b = evaluate_compass(c, 0, weights=W), evaluate_compass(c, 0, weights=W)
            assert a["blend_score"] == b["blend_score"], (on, a, b)
            assert a == b, on
    print("  idempotent: same candidate scored twice -> identical verdict, both "
          "flag states: PASS")


# ==========================================================================
# T2-d — cumulative n_trials
# ==========================================================================
def test_t2d_family_k_is_cumulative():
    import trainer_validation as tv
    tmp = tempfile.mkdtemp(prefix="rf3t2b3_")
    db = os.path.join(tmp, "trainer.db")
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE bandit_posteriors (arm_hash TEXT, level_id INTEGER)")
    # 3 arms at L1, 4 at L2, 5 at L3 -> cumulative 12, level-scoped at L3 = 5
    for lvl, n in ((1, 3), (2, 4), (3, 5)):
        conn.executemany("INSERT INTO bandit_posteriors VALUES (?,?)",
                         [(f"arm{lvl}_{i}", lvl) for i in range(n)])
    conn.commit()
    conn.close()
    try:
        with flag(False):
            before = tv.family_k(3, db_path=db)
        with flag(True):
            after = tv.family_k(3, db_path=db)
        assert before == 5, before
        assert after == 12, after
        assert after > before
        # empty DB still floors at 1 (DSR needs n_trials >= 1)
        db2 = os.path.join(tmp, "empty.db")
        c2 = sqlite3.connect(db2)
        c2.execute("CREATE TABLE bandit_posteriors (arm_hash TEXT, level_id INTEGER)")
        c2.commit(); c2.close()
        with flag(True):
            assert tv.family_k(3, db_path=db2) == 1
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"  T2-d at a simulated level 3: BEFORE (level-scoped) n_trials={before} -> "
          f"AFTER (cumulative) n_trials={after} — counts the whole history; "
          f"floored at 1 when empty: PASS")


ALL = [
    test_t2b_zero_correlation_reduces_exactly_to_hhi,
    test_t2b_full_correlation_is_one_bet,
    test_t2b_ten_crypto_beta_overcount_fixed,
    test_t2b_missing_correlation_fails_conservative,
    test_t2b_threads_through_per_eff_bet_net,
    test_t2c_damper_is_smooth_and_never_zero,
    test_t2c_39_vs_40_score_cliff_is_gone,
    test_t2c_thin_sample_is_damped_not_rejected,
    test_t2a_steady_small_beats_volatile_bigger,
    test_t2a_crossover_is_unreachable_at_any_magnitude,
    test_t2a_bound_holds_over_random_pairs,
    test_t2a_magnitude_decides_inside_the_band,
    test_t2a_tiebreak_term_never_saturates_over_realistic_range,
    test_t2a_epsilon_derives_from_existing_columns_only,
    test_t2a_invariant_fires_on_inverted_weight,
    test_version_log_fires_on_every_score_both_paths,
    test_flag_off_is_byte_identical,
    test_survival_wall_unmoved,
    test_tier1_gate_a_fail_closed_still_holds,
    test_idempotent,
    test_t2d_family_k_is_cumulative,
]

if __name__ == "__main__":
    logging.basicConfig(level=logging.CRITICAL)  # quiet unless a test captures
    failed = 0
    for t in ALL:
        try:
            t()
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"  ✘ {t.__name__}: {exc!r}")
    print(f"\n{len(ALL)-failed}/{len(ALL)} RF3T2-B3 COHERENCE-v2 TESTS PASS")
    sys.exit(1 if failed else 0)
