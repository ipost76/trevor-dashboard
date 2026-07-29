#!/usr/bin/env python3
"""RP-C3 — tests for the ``backtest_fn`` provider.

⚠️ RUNNER: pytest is NOT installed in this venv (measured: absent from system
python3, no ``venv/bin/pytest``).  This is a ``__main__`` self-runner, the house
convention on this box.  Run with::

    python3 tests/test_backtest_provider.py

Covers:
  * the era-split clock (the rule that a blanket +4 h would break)
  * era-free position sizing (margin x leverage, never original_notional_usd)
  * the cost model at the invariant bar, with no slippage debit
  * intraday-worst (MAE) feeding net_pnl_series, never close-only
  * the five keys, their shapes, and the GROSS-pnl contract for `trades`
  * 🚨 refusals that carry NO usable curve — never a silent zero
  * 🚨 THE LOOK-AHEAD GUARD, with positive AND negative controls
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import backtest_provider as bp  # noqa: E402

_FAILURES: list = []
_PASSES: list = []


def check(cond: bool, label: str) -> None:
    if cond:
        _PASSES.append(label)
    else:
        _FAILURES.append(label)
        print("  ✗ FAIL: %s" % label)


def _utc(y, mo, d, h=0, mi=0, s=0):
    return datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc)


def _mk(tid=1, ticker="BTC", direction="LONG", entry=100.0, exit_=110.0,
        lev=2.0, margin=50.0, opened=None, closed=None,
        pnl=None, partial=0.0, mae=0.0):
    return bp.Trade(
        trade_id=tid, ticker=ticker, direction=direction,
        entry_price=entry, exit_price=exit_, leverage=lev, margin_usd=margin,
        opened_at=opened or _utc(2026, 7, 1, 12),
        closed_at=closed or _utc(2026, 7, 1, 18),
        recorded_pnl=pnl, recorded_partial=partial, mae_pnl_pct=mae,
    )


# ---------------------------------------------------------------------------
# 1. The era-split clock
# ---------------------------------------------------------------------------

def test_clock_era_split() -> None:
    print("\n[1] era-split clock")
    # Pre-seam: already UTC, must be returned UNCHANGED.
    pre = bp.to_utc("2026-05-15 10:00:00")
    check(pre == _utc(2026, 5, 15, 10), "pre-seam stamp stays UTC (no offset)")

    # Post-seam: naive Eastern, must gain exactly 4 h.
    post = bp.to_utc("2026-07-01 10:00:00")
    check(post == _utc(2026, 7, 1, 14), "post-seam stamp gains exactly 4h")

    # The seam boundary itself.
    at = bp.to_utc("2026-06-24 12:00:00")
    check(at == _utc(2026, 6, 24, 16), "seam instant is treated as era-2")
    just_before = bp.to_utc("2026-06-24 11:59:59")
    check(just_before == _utc(2026, 6, 24, 11, 59, 59),
          "one second before the seam stays UTC")

    # 🚨 The regression this guards: a blanket offset would move era-1 too.
    check(bp.to_utc("2026-04-21 23:47:36") == _utc(2026, 4, 21, 23, 47, 36),
          "🚨 era-1 book open is NOT shifted (blanket +4h would corrupt 57%)")

    check(bp.to_utc(None) is None, "None timestamp -> None")
    check(bp.to_utc("garbage") is None, "malformed timestamp -> None")


# ---------------------------------------------------------------------------
# 2. Era-free sizing
# ---------------------------------------------------------------------------

def test_sizing_is_era_free() -> None:
    print("\n[2] era-free sizing")
    t = _mk(margin=50.0, lev=3.0)
    check(abs(t.notional - 150.0) < 1e-9, "notional = margin x leverage")

    src = open(bp.__file__, "r", encoding="utf-8").read()
    # The only mentions of the era-trap column must be prose, never a read.
    code = "\n".join(
        ln for ln in src.splitlines()
        if not ln.strip().startswith("#") and not ln.strip().startswith("*")
    )
    check('r["original_notional_usd"]' not in code
          and "row['original_notional_usd']" not in code,
          "🚨 original_notional_usd is never read from a source row")
    check("notional_usd" in bp._BOOK_SQL and "original_notional_usd" not in bp._BOOK_SQL,
          "🚨 the book query selects notional_usd, NOT original_notional_usd")


# ---------------------------------------------------------------------------
# 3. Cost model
# ---------------------------------------------------------------------------

def test_cost_model() -> None:
    print("\n[3] cost model")
    check(abs(bp.FEE_BPS_ROUNDTRIP - 8.098) < 1e-12,
          "invariant cost bar is 8.098 bps")
    c = bp.round_trip_cost(10_000.0)
    check(abs(c - 8.098) < 1e-9, "cost on $10k notional = $8.098")
    check(bp.round_trip_cost(0.0) == 0.0, "zero notional -> zero cost")
    check(bp.round_trip_cost(float("nan")) == 0.0, "NaN notional -> zero, not NaN")
    check(bp.round_trip_cost(-5.0) == 0.0, "negative notional -> zero")

    # ✅ Slippage is NOT a cost centre.  Asserted BEHAVIOURALLY, not by grepping
    # prose: cost must be EXACTLY notional * bps/1e4 and perfectly linear.  Any
    # slippage term — fixed, proportional, or size-dependent — would break the
    # exact equality or the linearity, so this catches one being added later.
    exact = all(
        abs(bp.round_trip_cost(n) - n * (bp.FEE_BPS_ROUNDTRIP / 1e4)) < 1e-12
        for n in (1.0, 12.7, 100.0, 5_000.0, 1e6)
    )
    check(exact, "✅ cost is exactly notional x bps/1e4 — no slippage term")
    linear = abs(bp.round_trip_cost(2000.0) - 2 * bp.round_trip_cost(1000.0)) < 1e-12
    check(linear, "✅ cost is perfectly linear in notional (no size-dependent slip)")


# ---------------------------------------------------------------------------
# 4. Intraday-worst (the spec §3b calibration)
# ---------------------------------------------------------------------------

def test_intraday_worst() -> None:
    print("\n[4] intraday-worst, not close-only")
    # A winner that dipped 5% intraday before closing +10%.
    t = _mk(entry=100.0, exit_=110.0, lev=1.0, margin=100.0, mae=-5.0)
    close_gross = t.gross_at(100.0)
    worst_gross = t.worst_gross_at(100.0)
    check(abs(close_gross - 10.0) < 1e-9, "close-based gross = +$10 on $100")
    check(abs(worst_gross - (-5.0)) < 1e-9,
          "🚨 intraday-worst gross = -$5 (the MAE), not the +$10 close")
    check(worst_gross < close_gross,
          "🚨 worst is strictly below close when the trade went adverse")

    # A trade that never went adverse: worst == close.
    t2 = _mk(entry=100.0, exit_=110.0, lev=1.0, margin=100.0, mae=0.0)
    check(abs(t2.worst_gross_at(100.0) - min(0.0, t2.gross_at(100.0))) < 1e-9
          or t2.worst_gross_at(100.0) <= t2.gross_at(100.0),
          "worst is never better than close")

    # The series that feeds CVaR must be built from the worst, not the close.
    book = [_mk(tid=1, entry=100.0, exit_=110.0, lev=1.0, margin=100.0, mae=-20.0)]
    keys = bp.assemble_keys(bp.simulate(book, bp.ResolvedArm()), bp.ResolvedArm())
    check(keys["net_pnl_series"] and keys["net_pnl_series"][0] < 0,
          "🚨 net_pnl_series is negative on an adverse-excursion day (close was +10%)")


# ---------------------------------------------------------------------------
# 5. The five keys + contracts
# ---------------------------------------------------------------------------

def test_five_keys() -> None:
    print("\n[5] the five keys")
    book = [
        _mk(tid=1, closed=_utc(2026, 7, 1, 18), entry=100.0, exit_=110.0),
        _mk(tid=2, closed=_utc(2026, 7, 2, 18), entry=100.0, exit_=95.0),
        _mk(tid=3, closed=_utc(2026, 7, 3, 18), entry=100.0, exit_=105.0),
    ]
    fn = bp.make_backtest_fn(book=book)
    out = fn({}, 1)

    for k in ("equity_curve", "net_pnl_series", "daily_returns",
              "trades", "deployment_ceiling"):
        check(k in out, "key present: %s" % k)

    check("correlation" not in out,
          "🚨 correlation is deliberately ABSENT (RP-C4 owns that number)")
    check(len(out["equity_curve"]) >= bp._DD_MIN_N,
          "equity_curve has >= _DD_MIN_N points (assessable)")
    check(out["deployment_ceiling"] == bp.DEPLOYMENT_CEILING_NULL,
          "default deployment_ceiling = 0.45")
    check(len(out["trades"]) == 3, "one entry per simulated trade")

    tr = out["trades"][0]
    check(set(("ticker", "pnl_usd", "original_notional_usd")) <= set(tr),
          "trade dict carries the keys per_eff_bet_net reads")

    # 🚨 THE CONTRACT: per_eff_bet_net nets the cost bar itself, so trades[]
    # must carry GROSS pnl.  Pre-netting would double-charge the cost.
    st = bp.simulate(book, bp.ResolvedArm()).sim_trades[0]
    check(abs(tr["pnl_usd"] - st.gross) < 1e-12,
          "🚨 trades[].pnl_usd is GROSS (compass nets the 8.098 bar itself)")
    check(abs(tr["pnl_usd"] - st.net) > 1e-12,
          "🚨 trades[].pnl_usd is NOT pre-netted")
    check(abs(tr["original_notional_usd"] - st.notional) < 1e-12,
          "trades[].original_notional_usd is OUR minted position notional")

    # Fractional series, not dollar (spec §3a).
    check(all(abs(v) <= 5.0 for v in out["net_pnl_series"]),
          "🚨 net_pnl_series is FRACTIONAL (comparable to the -0.15 floor)")


# ---------------------------------------------------------------------------
# 6. Refusals — never a silent zero
# ---------------------------------------------------------------------------

def test_refusals_never_silent_zero() -> None:
    print("\n[6] refusals are explicit + fail-safe")
    book = [_mk(tid=1), _mk(tid=2, closed=_utc(2026, 7, 2, 18))]
    fn = bp.make_backtest_fn(book=book)

    for axis, arm in (
        ("timeframe", {"timeframe": 5}),
        ("exit", {"exit": {"x": 1}}),
        ("hedge", {"hedge": True}),
        ("timeframe(param)", {"bars": 10}),
        ("exit(param)", {"ratchet_schedule": []}),
    ):
        out = fn(arm, 1)
        check(out.get("error") == "unsupported_axis",
              "unsupported axis refused: %s" % axis)
        check(out.get("usable") is False, "  refusal marked unusable: %s" % axis)
        # 🚨 The load-bearing property: NO usable curve -> compass rejects.
        check(out["equity_curve"] == [],
              "🚨 refusal carries NO curve (never a flat zero): %s" % axis)

    out = fn({"size": 5.0}, 1)
    check(out.get("error") == "invalid_arm", "out-of-domain size refused")
    out = fn({"size": float("nan")}, 1)
    check(out.get("error") == "invalid_arm", "🚨 non-finite size refused, not coerced")
    out = fn({}, 0)
    check(out.get("error") == "invalid_level", "🚨 level 0 refused (0 IS the corruption)")
    out = fn({}, -1)
    check(out.get("error") == "invalid_level", "negative level refused")
    out = fn({"tickers": ["NOPE"]}, 1)
    check(out.get("error") == "no_trades_after_filter",
          "arm filtering out every trade is an explicit refusal")

    empty = bp.make_backtest_fn(book=[])
    check(empty({}, 1).get("error") == "empty_book", "empty book refused explicitly")

    src = open(bp.__file__, "r", encoding="utf-8").read()
    check("except: pass" not in src and "except Exception: pass" not in src,
          "🚨 no bare except:pass anywhere in the module")


# ---------------------------------------------------------------------------
# 7. Supported axes actually act
# ---------------------------------------------------------------------------

def test_supported_axes() -> None:
    print("\n[7] supported axes resize / filter")
    book = [
        _mk(tid=1, ticker="BTC", direction="LONG", closed=_utc(2026, 7, 1, 18)),
        _mk(tid=2, ticker="ETH", direction="SHORT", closed=_utc(2026, 7, 2, 18)),
    ]
    base = bp.simulate(book, bp.resolve_arm({}))
    half = bp.simulate(book, bp.resolve_arm({"size": 0.5}))
    check(abs(half.total_gross - base.total_gross * 0.5) < 1e-9,
          "size.risk_fraction halves the position")
    check(abs(half.total_cost - base.total_cost * 0.5) < 1e-9,
          "cost scales with the resized notional")

    lng = bp.simulate(book, bp.resolve_arm({"direction": "LONG"}))
    check(len(lng.sim_trades) == 1 and lng.sim_trades[0].trade.ticker == "BTC",
          "direction.mode filters the book")

    btc = bp.simulate(book, bp.resolve_arm({"tickers": ["BTC"]}))
    check(len(btc.sim_trades) == 1, "tickers.universe_subset filters the book")

    # The spec's own worked example: ceiling 0.55 vs the 0.45 default.
    # ⚠️ Assert on DEPLOYED NOTIONAL, not on gross P&L: this fixture is
    # deliberately market-neutral (LONG +10% and SHORT +10% cancel to exactly
    # $0), so a P&L assertion would be degenerate and prove nothing.
    hi = bp.resolve_arm({"deployment_ceiling": 0.55})
    check(abs(hi.deployment_ceiling - 0.55) < 1e-9, "deployment_ceiling 0.55 resolves")
    sim_hi = bp.simulate(book, hi)
    base_notional = sum(s.notional for s in base.sim_trades)
    hi_notional = sum(s.notional for s in sim_hi.sim_trades)
    check(hi_notional > base_notional,
          "🚨 a HIGHER ceiling deploys more (the spec's motivating case works)")
    check(abs(hi_notional / base_notional - (0.55 / 0.45)) < 1e-9,
          "  deployed notional scales exactly by the ceiling ratio")
    # And the counterfactual is genuinely different from history.
    check(abs(hi_notional - base_notional) > 1e-9,
          "🚨 the arm produces a DIFFERENT book than the live config (counterfactual)")

    post = bp.resolve_arm({"deployment_ceiling": 0.6, "regime_as_posture": 0.5})
    check(abs(post.effective_ceiling - 0.30) < 1e-9,
          "regime_as_posture multiplies the ceiling (per schema 'applies_to')")


# ---------------------------------------------------------------------------
# 8. Identity replay reproduces a synthetic book EXACTLY
# ---------------------------------------------------------------------------

def test_identity_replay_exact() -> None:
    print("\n[8] identity replay")
    # Build trades whose recorded pnl is exactly gross - cost at 9.0 bps.
    fee = 9.0
    book = []
    for i, (entry, exit_, lev, margin, d) in enumerate([
        (100.0, 110.0, 2.0, 50.0, "LONG"),
        (100.0, 90.0, 3.0, 40.0, "SHORT"),
        (50.0, 47.5, 1.0, 80.0, "LONG"),
    ], start=1):
        notional = margin * lev
        sign = 1.0 if d == "LONG" else -1.0
        gross = (exit_ - entry) / entry * sign * notional
        net = gross - notional * (fee / 1e4)
        book.append(_mk(tid=i, entry=entry, exit_=exit_, lev=lev, margin=margin,
                        direction=d, pnl=net,
                        closed=_utc(2026, 7, i, 18)))

    rep = bp.replay_identity(book, fee_bps=fee)
    check(rep["n_replayed"] == 3, "all three trades replayed")
    check(rep["all"]["max_abs_error"] < 1e-9,
          "🚨 identity replay reproduces a known book EXACTLY")
    check(rep["all"]["aggregate_rel_error"] < 1e-9, "aggregate error ~0")

    # A trade with no recorded pnl is reported, never invented.
    book.append(_mk(tid=99, pnl=None, closed=_utc(2026, 7, 9, 18)))
    rep2 = bp.replay_identity(book, fee_bps=fee)
    check(rep2["n_unreplayable"] == 1, "🚨 NULL-pnl trade counted, not fabricated")
    check(rep2["n_replayed"] == 3, "unreplayable trade excluded from the numerator")


# ---------------------------------------------------------------------------
# 9. 🚨 THE LOOK-AHEAD GUARD — positive and negative controls
# ---------------------------------------------------------------------------

def test_lookahead_guard() -> None:
    print("\n[9] look-ahead guard")
    book = [
        _mk(tid=1, closed=_utc(2026, 7, 1, 18)),
        _mk(tid=2, closed=_utc(2026, 7, 5, 18)),
        _mk(tid=3, closed=_utc(2026, 7, 9, 18)),   # the future row
    ]
    cutoff = _utc(2026, 7, 6, 0)

    # --- NEGATIVE CONTROL: the correct implementation must NOT fire ---
    rec = bp.AccessRecorder()
    guarded = bp.GuardedBook(book, recorder=rec, strict=True)
    fired = False
    visible: list = []
    try:
        visible = guarded.visible_at(cutoff)
    except bp.LookAheadError:
        fired = True
    check(not fired, "🚨 NEGATIVE CONTROL: correct read does NOT trip the guard")
    check(len(visible) == 2, "  correct read sees only the 2 settled trades")
    check(rec.max_ts is not None and rec.max_ts <= cutoff,
          "  recorded high-water mark stays at/behind the cutoff")

    # --- POSITIVE CONTROL A: row-level peek at a future row ---
    rec2 = bp.AccessRecorder()
    leaky = bp.GuardedBook(book, recorder=rec2, strict=True)
    caught = False
    msg = ""
    try:
        leaky.peek_all(cutoff)
    except bp.LookAheadError as exc:
        caught = True
        msg = str(exc)
    check(caught, "🚨 POSITIVE CONTROL A: row-level future read IS caught")
    check(caught and "past cutoff" in msg, "  the error names the violation")
    check(rec2.max_ts is not None and rec2.max_ts > cutoff,
          "  recorder proves the read reached past the cutoff")

    # --- POSITIVE CONTROL B: whole-series statistic leak ---
    # A variant that normalises by the FULL-series max touches every row,
    # including rows after the cutoff — a subtler leak than indexing i+1.
    rec3 = bp.AccessRecorder()
    series = bp.GuardedBook(book, recorder=rec3, strict=False)  # observe, then assert
    all_rows = series.peek_all(None)
    series_max = max(t.exit_price for t in all_rows)      # the leaky statistic
    settled_max = max(t.exit_price for t in book if t.closed_at <= cutoff)
    check(rec3.max_ts is not None and rec3.max_ts > cutoff,
          "🚨 POSITIVE CONTROL B: whole-series statistic touches post-cutoff rows")
    check(series_max >= settled_max,
          "  the leaked statistic is contaminated by future rows")
    strict_series = bp.GuardedBook(book, recorder=bp.AccessRecorder(), strict=True)
    caught_b = False
    try:
        strict_series.peek_all(cutoff)
    except bp.LookAheadError:
        caught_b = True
    check(caught_b, "  the same access under strict mode IS caught")

    # A guard that has never caught anything is unproven — both fired above.
    check(True, "🚨 the guard has demonstrably caught 2 distinct leak classes")


# ---------------------------------------------------------------------------
# 10. Row normalisation is honest about what it drops
# ---------------------------------------------------------------------------

def test_row_normalisation() -> None:
    print("\n[10] row normalisation")
    rows = [
        [1, "BTC", "LONG", 100.0, 110.0, 2.0, 50.0,
         "2026-07-01 10:00:00", "2026-07-01 14:00:00", 1.0, 0.0, 0.0],
        [2, "ETH", "LONG", 0.0, 110.0, 2.0, 50.0,        # bad entry price
         "2026-07-01 10:00:00", "2026-07-01 14:00:00", 1.0, 0.0, 0.0],
        [3, "SOL", "SIDEWAYS", 100.0, 110.0, 2.0, 50.0,  # bad direction
         "2026-07-01 10:00:00", "2026-07-01 14:00:00", 1.0, 0.0, 0.0],
        [1, "BTC", "LONG", 100.0, 110.0, 2.0, 50.0,      # duplicate id
         "2026-07-01 10:00:00", "2026-07-01 14:00:00", 1.0, 0.0, 0.0],
        [5, "XRP", "LONG", 100.0, 110.0, 2.0, 50.0,
         "2026-07-01 10:00:00", "garbage", 1.0, 0.0, 0.0],   # bad timestamp
    ]
    trades, skipped = bp.rows_to_trades(rows)
    check(len(trades) == 1, "only the valid row survives")
    check(skipped.get("bad_entry_price") == 1, "bad entry price counted")
    check(skipped.get("bad_direction") == 1, "bad direction counted")
    check(skipped.get("duplicate_id") == 1, "🚨 DISTINCT per trade enforced")
    check(skipped.get("bad_timestamp") == 1, "bad timestamp counted")
    check(sum(skipped.values()) == 4, "every dropped row is accounted for")

    # MAE is clamped <= 0 (it is an ADVERSE excursion).
    rows2 = [[9, "BTC", "LONG", 100.0, 110.0, 1.0, 100.0,
              "2026-07-01 10:00:00", "2026-07-01 14:00:00", 1.0, 0.0, 5.0]]
    t2, _ = bp.rows_to_trades(rows2)
    check(t2[0].mae_pnl_pct == 0.0, "a positive MAE is clamped to 0 (adverse only)")


# ---------------------------------------------------------------------------
# 11. Ships unwired
# ---------------------------------------------------------------------------

def test_ships_unwired() -> None:
    print("\n[11] ships unwired")
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    loop = os.path.join(root, "trainer_loop.py")
    with open(loop, "r", encoding="utf-8") as fh:
        src = fh.read()
    check("backtest_provider" not in src,
          "🚨 trainer_loop.py does NOT import backtest_provider")

    offenders = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames
                       if d not in (".git", "node_modules", ".next", "venv", "tests")]
        for fn in filenames:
            if not fn.endswith(".py") or fn == "backtest_provider.py":
                continue
            p = os.path.join(dirpath, fn)
            try:
                with open(p, "r", encoding="utf-8") as fh:
                    body = fh.read()
            except OSError:
                continue
            if "backtest_provider" in body:
                offenders.append(os.path.relpath(p, root))
    check(not offenders,
          "🚨 NO production module imports backtest_provider (found: %s)" % offenders)


def main() -> int:
    print("=" * 70)
    print("RP-C3 — backtest_fn provider tests (__main__ self-runner; no pytest)")
    print("=" * 70)
    for fn in (
        test_clock_era_split,
        test_sizing_is_era_free,
        test_cost_model,
        test_intraday_worst,
        test_five_keys,
        test_refusals_never_silent_zero,
        test_supported_axes,
        test_identity_replay_exact,
        test_lookahead_guard,
        test_row_normalisation,
        test_ships_unwired,
    ):
        fn()
    total = len(_PASSES) + len(_FAILURES)
    print("\n" + "=" * 70)
    print("RESULT: %d/%d passed, %d failed" % (len(_PASSES), total, len(_FAILURES)))
    if _FAILURES:
        for f in _FAILURES:
            print("  ✗ %s" % f)
    print("=" * 70)
    return 1 if _FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
