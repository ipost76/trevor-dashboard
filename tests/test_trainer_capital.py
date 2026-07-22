#!/usr/bin/env python3
"""Tests for the R9-B5 capital-tuning + regime-posture proposals (trainer_capital.py).

Proves the load-bearing invariants (all DB-free — compass weights injected):
  * SURVIVAL-BOUND capital tuning: a proposed deployment_ceiling is ACCEPTED only
    if its candidate survives B1's two-gate wall; a ceiling that breaches the DD
    ceiling OR the CVaR floor is REJECTED and the conservative floor 0.45 holds.
  * The default 0.45 holds when the flag is off / nothing valid is proposed / the
    compass is unavailable.
  * AVAILABLE-NOT-FORCED regime posture: adopted ONLY when evaluate_compass improves
    WITH it vs without; declined when it does not (both directions proven).
  * Regime is NEVER a signal: it modifies ONLY deployment_ceiling (grep-assert on
    the code + the proposal record's ``applies_to``).
  * Flag-OFF inertness: proposals return the conservative default without calling
    the compass.

Dependency-free: `python3 tests/test_trainer_capital.py`. pytest-compatible.
"""
import io
import os
import sys
import tokenize

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

import trainer_capital as tc  # noqa: E402

_MODULE = os.path.join(_REPO, "trainer_capital.py")
_FLAG = tc.TRAINER_CAPITAL_ENABLED_ENV

# Injected level-0-style weights so no test ever touches the DB.
W = {"w_consistency": 0.7, "w_magnitude": 0.3, "dd_ceiling": 0.35, "cvar_floor": -0.15}

# Compass fixtures (mirror tests/test_compass_gates.py).
GOOD_PNL = [0.02] * 19 + [-0.10]      # worst-1 = -0.10 >= -0.15 -> CVaR PASS
BAD_PNL = [0.01] * 19 + [-0.42]       # worst-1 = -0.42 <  -0.15 -> CVaR FAIL
SHALLOW_EQUITY = [100, 102, 99, 103, 101, 105]   # dd ~0.039 -> DD PASS
DEEP_EQUITY = [100, 120, 60, 80, 55, 70]         # dd ~0.54  -> DD FAIL
DAILY = [0.01, -0.02, 0.03, -0.01, 0.02, -0.015, 0.025]
TRADES = [{"pnl_usd": 10.0, "original_notional_usd": 1000.0, "ticker": "BTC"},
          {"pnl_usd": 8.0, "original_notional_usd": 1000.0, "ticker": "ETH"}]


def _survivor(ceiling=None):
    c = {"equity_curve": SHALLOW_EQUITY, "net_pnl_series": GOOD_PNL,
         "daily_returns": DAILY, "trades": TRADES}
    if ceiling is not None:
        c["deployment_ceiling"] = ceiling
    return c


def _breacher(ceiling=None):
    c = {"equity_curve": DEEP_EQUITY, "net_pnl_series": BAD_PNL,
         "daily_returns": DAILY, "trades": TRADES}
    if ceiling is not None:
        c["deployment_ceiling"] = ceiling
    return c


class _enable_flag:
    """with _enable_flag():  → TRAINER_CAPITAL_ENABLED on for the block, restored after."""
    def __enter__(self):
        self._old = os.environ.get(_FLAG)
        os.environ[_FLAG] = "true"

    def __exit__(self, *a):
        if self._old is None:
            os.environ.pop(_FLAG, None)
        else:
            os.environ[_FLAG] = self._old


def _code_tokens(path):
    src = open(path).read()
    out = []
    for tok in tokenize.generate_tokens(io.StringIO(src).readline):
        if tok.type in (tokenize.STRING, tokenize.COMMENT,
                        getattr(tokenize, "FSTRING_MIDDLE", -1)):
            continue
        if tok.string.strip():
            out.append(tok.string)
    return out


# ── 1. SURVIVAL-BOUND: a survival-safe ceiling is ACCEPTED; a breaching one REJECTED ──
def test_survival_safe_ceiling_accepted():
    with _enable_flag():
        out = tc.propose_deployment_ceiling(_survivor(0.55), 0, weights=W)
    assert out == 0.55, out          # the survived proposal is returned as-is
    print("  survival-safe ceiling 0.55 ACCEPTED: PASS")


def test_breaching_ceiling_rejected_holds_null():
    with _enable_flag():
        out = tc.propose_deployment_ceiling(_breacher(0.80), 0, weights=W)
    assert out == tc.DEPLOYMENT_CEILING_NULL == 0.45, out   # rejected -> conservative floor
    print("  gate-breaching ceiling 0.80 REJECTED -> holds 0.45 (survival-bound): PASS")


# ── 2. The default 0.45 holds when nothing valid is proposed / invalid domain ──
def test_no_or_invalid_proposal_holds_null():
    with _enable_flag():
        assert tc.propose_deployment_ceiling(_survivor(), 0, weights=W) == 0.45      # no key
        for bad in (0.0, -0.2, 1.5, "x", True, None):                                # off-domain
            assert tc.propose_deployment_ceiling(_survivor(bad), 0, weights=W) == 0.45, bad
    print("  no/invalid proposed ceiling -> 0.45 conservative floor holds: PASS")


# ── 3. compass unavailable -> conservative default (never crashes) ──
def test_compass_unavailable_holds_null():
    orig = tc._get_evaluate_compass
    tc._get_evaluate_compass = lambda: None
    try:
        with _enable_flag():
            assert tc.propose_deployment_ceiling(_survivor(0.55), 0, weights=W) == 0.45
            r = tc.propose_regime_posture(
                {"baseline": _survivor(), "with_posture": _survivor(),
                 "posture": {"VOLATILE": 0.6}}, 0, weights=W)
            assert r["adopt"] is False and "compass unavailable" in r["reason"], r
    finally:
        tc._get_evaluate_compass = orig
    print("  compass unavailable -> conservative default (0.45 / no posture): PASS")


# ── 4. FLAG-OFF inertness: no compass call, conservative default ──
def test_flag_off_inert_no_compass():
    os.environ.pop(_FLAG, None)
    orig = tc._get_evaluate_compass

    def _poison():
        raise AssertionError("flag OFF must not touch the compass")

    tc._get_evaluate_compass = _poison
    try:
        assert tc.enabled() is False
        assert tc.propose_deployment_ceiling(_survivor(0.55), 0, weights=W) == 0.45
        r = tc.propose_regime_posture(
            {"baseline": _survivor(), "with_posture": _survivor(),
             "posture": {"VOLATILE": 0.6}}, 0, weights=W)
        assert r["adopt"] is False and "off" in r["reason"], r
    finally:
        tc._get_evaluate_compass = orig
    print("  flag OFF -> inert (no compass, 0.45 / no posture): PASS")


# ── 5. AVAILABLE-NOT-FORCED: adopt when the compass improves WITH the posture ──
def test_regime_posture_adopted_when_improves():
    # baseline BREACHES the wall; the posture (trade smaller in chaos) makes it SURVIVE.
    cand = {"baseline": _breacher(), "with_posture": _survivor(),
            "posture": {"VOLATILE": 0.6, "RANGING": 0.85, "TRENDING": 1.0}}
    with _enable_flag():
        r = tc.propose_regime_posture(cand, 0, weights=W)
    assert r["adopt"] is True, r
    assert r["posture"] == cand["posture"], r
    assert r["applies_to"] == "deployment_ceiling" and r["never_a_signal"] is True, r
    assert r["compass_with"]["survived"] is True and r["compass_without"]["survived"] is False, r
    print("  regime posture ADOPTED when compass improves (breach -> survive): PASS")


# ── 6. AVAILABLE-NOT-FORCED: decline when it does NOT improve (both directions) ──
def test_regime_posture_declined_when_no_improvement():
    with _enable_flag():
        # (a) both survive but NOT strictly better (identical) -> decline.
        same = {"baseline": _survivor(), "with_posture": _survivor(),
                "posture": {"VOLATILE": 0.8}}
        r_same = tc.propose_regime_posture(same, 0, weights=W)
        assert r_same["adopt"] is False and r_same["posture"] is None, r_same
        assert "available-not-forced" in r_same["reason"], r_same
        # (b) posture BREAKS survival (baseline survives, with_posture breaches) -> decline.
        worse = {"baseline": _survivor(), "with_posture": _breacher(),
                 "posture": {"VOLATILE": 0.4}}
        r_worse = tc.propose_regime_posture(worse, 0, weights=W)
        assert r_worse["adopt"] is False and r_worse["posture"] is None, r_worse
    print("  regime posture DECLINED when no improvement (equal + survival-break): PASS")


# ── 7. degenerate regime data -> declined (conservative default) ──
def test_regime_degenerate_data_declines():
    with _enable_flag():
        for bad in (None, {}, {"baseline": _survivor()},                       # missing pieces
                    {"baseline": _survivor(), "with_posture": _survivor(), "posture": {}}):
            r = tc.propose_regime_posture(bad, 0, weights=W)
            assert r["adopt"] is False and r["posture"] is None, (bad, r)
            assert "degenerate" in r["reason"], (bad, r)
    print("  degenerate regime data -> no posture adopted: PASS")


# ── 8. REGIME IS NEVER A SIGNAL (grep-assert on the code + the record) ──
def test_regime_never_enters_signal_path():
    # No signal-field IDENTIFIER anywhere in the code (strings/comments stripped, so a
    # docstring mention can't false-flag) — the "never a signal field" structural proof.
    toks = " ".join(_code_tokens(_MODULE))
    for banned in ("CandidateSignal", "confidence", "signal_score", "entry_signal",
                   "signal_path"):
        assert banned not in toks, f"regime-as-signal leak: code token {banned!r} present"
    # Positive (raw source — these are string literals the token scan strips): the
    # posture applies ONLY to deployment_ceiling, tagged never_a_signal.
    src = open(_MODULE).read()
    assert "applies_to" in src and "deployment_ceiling" in src and "never_a_signal" in src
    with _enable_flag():
        r = tc.propose_regime_posture(
            {"baseline": _breacher(), "with_posture": _survivor(),
             "posture": {"VOLATILE": 0.6}}, 0, weights=W)
    assert r["applies_to"] == "deployment_ceiling" and r["never_a_signal"] is True, r
    print("  regime modifies ONLY deployment_ceiling, never a signal field: PASS")


_TESTS = [
    test_survival_safe_ceiling_accepted,
    test_breaching_ceiling_rejected_holds_null,
    test_no_or_invalid_proposal_holds_null,
    test_compass_unavailable_holds_null,
    test_flag_off_inert_no_compass,
    test_regime_posture_adopted_when_improves,
    test_regime_posture_declined_when_no_improvement,
    test_regime_degenerate_data_declines,
    test_regime_never_enters_signal_path,
]


if __name__ == "__main__":
    print("=== trainer_capital tests (R9-B5) ===")
    fails = 0
    for t in _TESTS:
        try:
            t()
        except AssertionError as e:
            fails += 1
            print(f"  {t.__name__}: FAIL — {e}")
        except Exception as e:  # noqa: BLE001
            fails += 1
            print(f"  {t.__name__}: ERROR — {type(e).__name__}: {e}")
    print(f"=== {len(_TESTS) - fails}/{len(_TESTS)} PASS ===")
    sys.exit(1 if fails else 0)
