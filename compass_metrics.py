#!/usr/bin/env python3
"""compass_metrics.py — THE COMPASS: the objective function TREVOR v5's R9 trainer
optimizes toward for the life of the project.

Ghost's locked design (survival engineering, not a preference — §9):

  1. SURVIVAL is a hard CONSTRAINT, never a weighted term. TWO gates, ANDed:
       (a) a bounded max-drawdown ceiling  (catches the slow bleed), AND
       (b) a left-tail / CVaR floor        (catches the one-day cascade — the
           2025-10-10-class intraday wick a DD-average misses).
     A config is REJECTED at ANY return if it fails EITHER gate.
  2. CONSISTENCY (Sortino, downside deviation) ALWAYS outranks MAGNITUDE — a
     fixed order. Only the consistency<->magnitude blend flexes per level, and
     even then w_consistency >= w_magnitude is a clamped code invariant:
     magnitude can NEVER outrank consistency.
  3. MAGNITUDE (total return) is the tiebreaker, measured NET of the 8.098 bps
     cost bar, PER EFFECTIVE BET.

WHY A STANDALONE stdlib MODULE (A1 / RECON-TRAINER-001):
  * The compass runs on the WSL box (ghost@Ghost) for cheap pre-scoring, where
    importing anything under the `auto_trader` package trips the WSL import
    barrier (auto_trader/__init__.py) + a PermissionError. So every metric here
    is EXTRACTED (re-implemented) from its private VM source, NEVER imported:
      - cvar_95   <- 12_financial_analytics._cvar     (numeric-named module,
      - sortino   <- 12_financial_analytics._sortino    not importable at all)
      - max_drawdown <- auto_trader/portfolio/hedging.max_drawdown  (barrier)
      - _standardized_cost <- auto_trader/validation/shadow_feeder  (barrier)
  * This module imports NOTHING from auto_trader.* — which also means there is
    NO reachable import path to auto_trader.validation.alpha_budget.reset()
    (the "farming hole", A1 rec #2). Pure stdlib + lib.trainer_db (B0, stdlib).
  * numpy is deliberately NOT used — the extracted sources are pure-Python and
    numpy is absent on WSL. Pure stdlib guarantees a clean WSL import.

Python 3, stdlib only. Reads/writes ONLY the trainer's own compass_weights table
(via B0's `from lib.trainer_db import get_connection`), never the live trevor.db.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, NamedTuple, Optional, Sequence, Union

# ---------------------------------------------------------------------------
# The standardized round-trip cost bar. SINGLE SOURCE OF TRUTH is
# shadow_feeder.py:84 (FEE_BPS_ROUNDTRIP = 8.098) — mirrored here (not imported)
# because importing shadow_feeder trips the auto_trader WSL barrier. bps of
# position notional, BOTH legs. Frequency-invariant — every trade pays it.
# If shadow_feeder.py:84 ever changes, this MUST be updated to match.
# ---------------------------------------------------------------------------
FEE_BPS_ROUNDTRIP: float = 8.098

# Feature flag: nothing in this module auto-executes at import (all pure
# functions), so no gating is needed for the metrics themselves. Only the
# guarded __main__ smoke below honors this. cfg-style default OFF.
TRAINER_COMPASS_ENABLED_ENV = "TRAINER_COMPASS_ENABLED"

# Minimum-sample guards, mirrored verbatim from the extracted sources so the
# public functions behave identically to the private originals.
_SORTINO_MIN_N = 3   # _sortino: len(daily) < 3 -> None
_CVAR_MIN_N = 5      # _cvar:    len(xs) < 5    -> None


# ===========================================================================
# 0. Pure math helpers (extracted from 12_financial_analytics.py:110 "_mean")
# ===========================================================================
def _mean(xs: Sequence[float]) -> float:
    """Arithmetic mean; 0.0 on empty. Verbatim from 12_financial_analytics._mean."""
    return sum(xs) / len(xs) if xs else 0.0


def _values(series: Sequence[Any]) -> List[float]:
    """Coerce a series to a list of floats, tolerating both bare numbers and
    ``(timestamp, value)`` pairs (the hedging.py max_drawdown input shape).
    Non-numeric / malformed entries are skipped rather than crashing."""
    out: List[float] = []
    for item in series:
        v: Any
        if isinstance(item, (tuple, list)):
            if len(item) < 2:
                continue
            v = item[1]
        else:
            v = item
        try:
            fv = float(v)
        except (TypeError, ValueError):
            continue
        if math.isnan(fv) or math.isinf(fv):
            continue
        out.append(fv)
    return out


# ===========================================================================
# 1. cvar_95 — extracted from 12_financial_analytics.py:258 "_cvar"
#    Left-tail conditional value-at-risk: the mean of the worst `pct` fraction
#    of the distribution. Gate (b) source (the cascade catcher).
# ===========================================================================
def cvar_95(xs: Sequence[float], pct: float = 0.05) -> Optional[float]:
    """Conditional Value-at-Risk at the (1-pct) level: mean of the worst `pct`
    tail of ``xs``. Returns a (typically negative) number = the expected loss in
    the tail; ``None`` when there is insufficient data (< 5 observations, per the
    _cvar guard) or a degenerate input.

    Faithful re-implementation of ``12_financial_analytics._cvar`` — proven
    equal to the private original in the unit tests. `xs` is a net-PnL / return
    series (per-trade or per-period). Malformed entries are dropped first.
    """
    clean = _values(xs)
    if len(clean) < _CVAR_MIN_N:
        return None
    s = sorted(clean)
    cutoff = max(1, int(len(s) * pct))
    return _mean(s[:cutoff])


# ===========================================================================
# 2. sortino — extracted from 12_financial_analytics.py:228 "_sortino"
#    Downside-deviation-based risk-adjusted return. The CONSISTENCY term.
#    NB the downside deviation divides by len(daily), NOT len(downs) — verbatim.
# ===========================================================================
def sortino(daily_returns: Sequence[float], ann: int = 365) -> Optional[float]:
    """Sortino ratio (annualized) of a daily-return series: mean / downside-
    deviation * sqrt(ann). Returns ``None`` on insufficient data (< 3), and the
    sentinel ``99.0`` when there is no downside at all but positive mean (an
    all-up series) — both behaviors verbatim from ``12_financial_analytics._sortino``.

    Faithful re-implementation — proven equal to the private original in the
    unit tests. The CONSISTENCY term of the compass; higher is better.
    """
    clean = _values(daily_returns)
    if len(clean) < _SORTINO_MIN_N:
        return None
    m = _mean(clean)
    downs = [x for x in clean if x < 0]
    if not downs:
        return 99.0 if m > 0 else None
    # downside deviation: divides by len(clean), NOT len(downs) — verbatim.
    dd = (sum(x * x for x in downs) / len(clean)) ** 0.5
    if dd == 0:
        return 0.0
    return (m / dd) * (ann ** 0.5)


# ===========================================================================
# 3a. max_drawdown — extracted from hedging.py:303 (faithful, USD magnitude)
#     Kept for the extraction-equivalence test. Returns a NON-NEGATIVE peak-to-
#     trough decline in the series' own units (0.0 = never declined).
# ===========================================================================
def max_drawdown(series: Sequence[Any]) -> float:
    """Worst peak-to-trough decline over the series, as a NON-NEGATIVE magnitude
    (0.0 = the series never declined). Faithful re-implementation of
    ``hedging.max_drawdown`` — accepts the original ``[(timestamp, value), ...]``
    shape (and, tolerantly, a bare value series). Proven equal to the private
    original in the unit tests.
    """
    peak: Optional[float] = None
    worst = 0.0
    for value in _values(series):
        if peak is None or value > peak:
            peak = value
        decline = peak - value
        if decline > worst:
            worst = decline
    return worst


# ===========================================================================
# 3b. max_drawdown_frac — the SCALE-INVARIANT gate (a) input.
#     Fractional peak-to-trough decline: max_t (peak - value) / peak.
#     Same peak-tracking logic as the faithful version, normalized so the
#     dd_ceiling threshold is a fraction (e.g. 0.35), independent of account
#     size — the right form for a config-level compass (Ghost-confirmed).
# ===========================================================================
def max_drawdown_frac(equity_curve: Sequence[Any]) -> float:
    """Fractional maximum drawdown over an equity curve: the worst
    ``(peak - value) / peak`` (0.0 = never declined). Scale-invariant — this is
    the value Gate (a) compares against ``dd_ceiling``.

    Accepts a bare equity-value series or ``(timestamp, value)`` pairs. A peak
    of <= 0 contributes no fractional drawdown (guards div-by-zero / a series
    that starts at/below zero). Empty/degenerate -> 0.0.
    """
    peak: Optional[float] = None
    worst = 0.0
    for value in _values(equity_curve):
        if peak is None or value > peak:
            peak = value
        if peak is not None and peak > 0.0:
            frac = (peak - value) / peak
            if frac > worst:
                worst = frac
    return worst


# ===========================================================================
# 4. n_eff_bets — NEW (grep=0 repo-wide). Effective number of independent bets
#    = 1 / HHI(normalized ticker notional weights). Herfindahl inverse.
# ===========================================================================
def n_eff_bets(weights: Union[Dict[str, float], Sequence[float]]) -> float:
    """Effective number of bets = ``1 / HHI`` over ticker notional weights,
    where HHI = sum(w_i^2) of the L1-normalized non-negative weights.

    Equal weights over N tickers -> N (e.g. 4 -> 4.0); all mass on one ticker
    -> 1.0. Empty / all-zero / degenerate weights -> 1.0 (a single effective
    bet — the conservative floor). Negative weights are treated by magnitude
    (abs) before normalizing; notional weights are non-negative in practice.
    """
    if isinstance(weights, dict):
        raw = list(weights.values())
    else:
        raw = list(weights)

    mags: List[float] = []
    for w in raw:
        try:
            fw = abs(float(w))
        except (TypeError, ValueError):
            continue
        if math.isnan(fw) or math.isinf(fw):
            continue
        mags.append(fw)

    total = sum(mags)
    if total <= 0.0 or not mags:
        return 1.0
    hhi = sum((m / total) ** 2 for m in mags)
    if hhi <= 0.0:
        return 1.0
    return 1.0 / hhi


# ---------------------------------------------------------------------------
# _standardized_cost — extracted from shadow_feeder.py:104 (WSL-safe piece).
# The 8.098 bps RT bar in $ on the trade's ORIGINAL notional (the notional
# trap: original_notional_usd, NOT the post-entry partial-reduced notional).
# Returns None when the notional is missing / non-positive (-> cannot-net).
# ---------------------------------------------------------------------------
def _standardized_cost(original_notional_usd: Any) -> Optional[float]:
    try:
        n = float(original_notional_usd)
    except (TypeError, ValueError):
        return None
    if math.isnan(n) or math.isinf(n) or not (n > 0.0):
        return None
    return (FEE_BPS_ROUNDTRIP / 1e4) * n


class PerEffBetNet(NamedTuple):
    """Result of per_eff_bet_net. `.value` is the headline metric (magnitude
    term of the compass): total net-of-cost $ divided by n_eff_bets."""
    value: float               # total_net / n_eff_bets  (the magnitude score)
    total_net: float           # sum of per-trade net-of-cost $ over charged trades
    n_charged: int             # trades that carried a resolvable notional
    n_skipped_uncharged: int   # trades skipped (missing/<=0 notional) — NEVER $0
    n_eff_bets: float          # 1 / HHI over the charged trades' notional weights


# ===========================================================================
# 5. per_eff_bet_net — NEW. Net-of-cost realized $ PER EFFECTIVE BET.
#    net_per_trade = gross_pnl - _standardized_cost(original_notional_usd).
#    A trade with missing / <=0 notional is SKIPPED and COUNTED
#    (n_skipped_uncharged) — NEVER coerced to $0 (A1: no uncharged edge slips in).
# ===========================================================================
def per_eff_bet_net(
    trades: Sequence[Dict[str, Any]],
    *,
    pnl_key: str = "pnl_usd",
    notional_key: str = "original_notional_usd",
    ticker_key: str = "ticker",
) -> PerEffBetNet:
    """Compute total net-of-cost realized $ per effective bet over a batch of
    trades (candidate-simulator output — each carries a GROSS realized pnl the
    caller supplies; this nets the 8.098 bps cost bar off it).

    For each trade: ``net = gross_pnl - _standardized_cost(notional)``. When the
    notional can't be resolved (missing / non-numeric / <= 0), the trade is
    SKIPPED and counted in ``n_skipped_uncharged`` — never coerced to $0 (that
    would smuggle an uncharged edge into the objective, A1). Effective bets are
    computed as ``1 / HHI`` over the CHARGED trades' per-ticker notional weights,
    so a concentrated book earns fewer effective bets. Trades missing a ticker
    are bucketed under a synthetic per-trade key (each counts as its own name),
    which is the conservative (higher-HHI) treatment.

    Empty / all-uncharged batch -> value 0.0, n_eff_bets 1.0 (degenerate floor).
    """
    total_net = 0.0
    n_charged = 0
    n_skipped = 0
    notional_by_ticker: Dict[str, float] = {}

    for i, t in enumerate(trades):
        if not isinstance(t, dict):
            n_skipped += 1
            continue
        cost = _standardized_cost(t.get(notional_key))
        if cost is None:
            n_skipped += 1
            continue
        raw_pnl = t.get(pnl_key)
        if raw_pnl is None:
            n_skipped += 1
            continue
        try:
            gross = float(raw_pnl)
        except (TypeError, ValueError):
            # A resolvable notional but an unresolvable gross pnl is still
            # uncharged/unusable — skip + count, never coerce to $0.
            n_skipped += 1
            continue
        if math.isnan(gross) or math.isinf(gross):
            n_skipped += 1
            continue

        net = gross - cost
        total_net += net
        n_charged += 1
        # Recover the (> 0) notional exactly from the cost we just computed,
        # avoiding a second parse of the raw field (cost = notional * bps/1e4).
        notional = cost / (FEE_BPS_ROUNDTRIP / 1e4)
        tk = t.get(ticker_key)
        key = str(tk) if tk not in (None, "") else f"__trade_{i}__"
        notional_by_ticker[key] = notional_by_ticker.get(key, 0.0) + notional

    eff = n_eff_bets(notional_by_ticker) if notional_by_ticker else 1.0
    value = total_net / eff if eff > 0.0 else total_net
    return PerEffBetNet(
        value=value,
        total_net=total_net,
        n_charged=n_charged,
        n_skipped_uncharged=n_skipped,
        n_eff_bets=eff,
    )


# ===========================================================================
# PHASE 2 — THE SURVIVAL WALL + FIXED-ORDER/LEARNED-BLEND SCORING
# ===========================================================================
import logging

_log = logging.getLogger("compass")

# Level-0 seed calibration (threshold decisions — see Preference Changes).
# dd_ceiling is a FRACTION (scale-invariant); cvar_floor is a fractional
# left-tail floor calibrated so the 2025-10-10 cascade FAILS it (Phase 3).
# The blend seed enforces the fixed order structurally: w_consistency > w_magnitude.
SEED_DD_CEILING: float = 0.35        # reject if fractional max-drawdown > 35%
SEED_CVAR_FLOOR: float = -0.15       # reject if worst-5% tail mean < -15%
SEED_W_CONSISTENCY: float = 0.7      # consistency dominates the blend...
SEED_W_MAGNITUDE: float = 0.3        # ...magnitude only breaks near-ties

# Candidate keys the compass reads (the candidate-simulator supplies them).
_K_EQUITY = "equity_curve"       # gate (a): fractional max-drawdown
_K_NET_PNL = "net_pnl_series"    # gate (b): cvar_95 left-tail
_K_DAILY = "daily_returns"       # consistency: sortino
_K_TRADES = "trades"             # magnitude: per_eff_bet_net


def _enforce_fixed_order(w_consistency: float, w_magnitude: float):
    """The CODE INVARIANT: consistency's weight can never fall below magnitude's.
    Returns (w_consistency, w_magnitude, clamped). If a (learned) weight ever
    tries to invert the order, MAGNITUDE is clamped down to consistency and the
    event is logged — magnitude can NEVER outrank consistency. This is survival
    engineering, not a preference: if magnitude wins, the whole compass fails.
    """
    clamped = False
    if w_magnitude > w_consistency:
        _log.warning(
            "🚨 COMPASS FIXED-ORDER VIOLATION: learned w_magnitude=%.4f > "
            "w_consistency=%.4f — clamping magnitude to consistency. Magnitude "
            "must NEVER outrank consistency.", w_magnitude, w_consistency,
        )
        w_magnitude = w_consistency
        clamped = True
    # Post-clamp invariant — always holds.
    assert w_consistency >= w_magnitude, "fixed-order invariant broke after clamp"
    return w_consistency, w_magnitude, clamped


def survival_gates(candidate: Dict[str, Any], thresholds: Dict[str, float]) -> Dict[str, Any]:
    """The TWO-GATE survival WALL — DD ceiling AND CVaR floor, ANDed. A candidate
    that breaches EITHER is rejected at ANY return.

      Gate (a): max_drawdown_frac(equity_curve) <= dd_ceiling   (the slow bleed)
      Gate (b): cvar_95(net_pnl_series)         >= cvar_floor    (the one-day wick)

    Returns {passed, dd, cvar, dd_ceiling, cvar_floor, failing}. `failing` names
    the breached gate(s). SURVIVAL-FIRST: an unassessable left tail (cvar None,
    < 5 observations) FAILS gate (b) — you cannot clear the survival wall on a
    tail you cannot prove is safe.
    """
    dd_ceiling = float(thresholds["dd_ceiling"])
    cvar_floor = float(thresholds["cvar_floor"])

    dd = max_drawdown_frac(candidate.get(_K_EQUITY, []))
    cvar = cvar_95(candidate.get(_K_NET_PNL, []))

    failing: List[str] = []
    gate_a = dd <= dd_ceiling
    if not gate_a:
        failing.append("dd_ceiling")
    # cvar None -> cannot assess the tail -> conservative FAIL (survival-first).
    gate_b = cvar is not None and cvar >= cvar_floor
    if not gate_b:
        failing.append("cvar_floor" if cvar is not None else "cvar_floor(insufficient_tail)")

    return {
        "passed": gate_a and gate_b,   # ANDed — either failure rejects
        "dd": dd,
        "cvar": cvar,
        "dd_ceiling": dd_ceiling,
        "cvar_floor": cvar_floor,
        "failing": failing,
    }


def _read_compass_weights(conn, level: int) -> Dict[str, Any]:
    """Read the per-level blend + gate thresholds from compass_weights, falling
    back to level 0, then to the SEED_* constants (so an unseeded DB never
    crashes evaluate_compass). Returns a dict of the 5 columns."""
    row = None
    if conn is not None:
        row = conn.execute(
            "SELECT w_consistency, w_magnitude, dd_ceiling, cvar_floor, learned "
            "FROM compass_weights WHERE level_id = ?", (int(level),),
        ).fetchone()
        if row is None and level != 0:
            row = conn.execute(
                "SELECT w_consistency, w_magnitude, dd_ceiling, cvar_floor, learned "
                "FROM compass_weights WHERE level_id = 0",
            ).fetchone()
    if row is not None:
        return {
            "w_consistency": float(row[0]),
            "w_magnitude": float(row[1]),
            "dd_ceiling": float(row[2]),
            "cvar_floor": float(row[3]),
            "learned": int(row[4]),
            "source": "db",
        }
    # No row anywhere — fall back to the seed constants (never crash).
    return {
        "w_consistency": SEED_W_CONSISTENCY,
        "w_magnitude": SEED_W_MAGNITUDE,
        "dd_ceiling": SEED_DD_CEILING,
        "cvar_floor": SEED_CVAR_FLOOR,
        "learned": 0,
        "source": "seed_fallback",
    }


def evaluate_compass(
    candidate: Dict[str, Any],
    level: int,
    *,
    conn: Any = None,
    weights: Optional[Dict[str, float]] = None,
) -> Dict[str, Any]:
    """THE COMPASS. Accept/reject + score a candidate config for a given level.

    Order (fixed, load-bearing):
      1. SURVIVAL WALL — run survival_gates. If not passed -> survived=False,
         return IMMEDIATELY. NO consistency/magnitude is computed (rejected at
         any return). This short-circuit is the wall.
      2. CONSISTENCY (sortino) always outranks MAGNITUDE (per_eff_bet_net).
      3. blend_score = w_consistency*consistency + w_magnitude*magnitude, with
         w_consistency >= w_magnitude enforced (clamp+log) — magnitude can NEVER
         outrank consistency.

    Weights/thresholds come from compass_weights[level] (fallback level 0, then
    the seed constants), or the injected `weights` dict (for tests). Reads the
    trainer's own trainer.db via B0's get_connection when `conn` is None.

    Returns a verdict dict: {survived, consistency, magnitude, blend_score,
    verdict, failing_gates, ...}.
    """
    own_conn = False
    if weights is None:
        if conn is None:
            from lib.trainer_db import get_connection  # B0 — stdlib sqlite3 only
            conn = get_connection()
            own_conn = True
        weights = _read_compass_weights(conn, level)
        if own_conn:
            conn.close()

    thresholds = {"dd_ceiling": weights["dd_ceiling"], "cvar_floor": weights["cvar_floor"]}
    gates = survival_gates(candidate, thresholds)

    # ---- STEP 1: the WALL. Rejected at any return; NOTHING else computed. ----
    if not gates["passed"]:
        return {
            "survived": False,
            "consistency": None,
            "magnitude": None,
            "blend_score": None,
            "verdict": "rejected",
            "failing_gates": gates["failing"],
            "gates": gates,
            "level": int(level),
        }

    # ---- STEP 2: consistency ALWAYS outranks magnitude ----
    consistency = sortino(candidate.get(_K_DAILY, []))
    mag_detail = per_eff_bet_net(candidate.get(_K_TRADES, []))
    magnitude = mag_detail.value

    # ---- STEP 3: fixed-order blend (clamped invariant) ----
    w_c, w_m, clamped = _enforce_fixed_order(
        float(weights["w_consistency"]), float(weights["w_magnitude"]),
    )
    if consistency is None:
        blend_score = None
        verdict = "survived_unscorable"  # survived the wall, sortino has < 3 obs
    else:
        blend_score = w_c * consistency + w_m * magnitude
        verdict = "scored"

    return {
        "survived": True,
        "consistency": consistency,
        "magnitude": magnitude,
        "blend_score": blend_score,
        "verdict": verdict,
        "failing_gates": [],
        "gates": gates,
        "level": int(level),
        "weights_used": {"w_consistency": w_c, "w_magnitude": w_m, "clamped": clamped},
        "magnitude_detail": {
            "total_net": mag_detail.total_net,
            "n_charged": mag_detail.n_charged,
            "n_skipped_uncharged": mag_detail.n_skipped_uncharged,
            "n_eff_bets": mag_detail.n_eff_bets,
        },
    }


def seed_compass_weights_level0(
    conn: Any = None,
    *,
    dd_ceiling: float = SEED_DD_CEILING,
    cvar_floor: float = SEED_CVAR_FLOOR,
    w_consistency: float = SEED_W_CONSISTENCY,
    w_magnitude: float = SEED_W_MAGNITUDE,
) -> Dict[str, Any]:
    """Seed the level-0 compass_weights row (the default the trainer starts from
    before it learns per-level). Additive + idempotent: INSERT OR IGNORE, so an
    existing (possibly learned) row is NEVER overwritten. Enforces the fixed
    order on the seed weights before writing.

    Not called on import — an explicit one-shot. Returns the row that is now in
    the DB for level 0 (existing or freshly seeded).
    """
    w_consistency, w_magnitude, _ = _enforce_fixed_order(w_consistency, w_magnitude)
    own_conn = False
    if conn is None:
        from lib.trainer_db import get_connection
        conn = get_connection()
        own_conn = True
    try:
        from lib.trainer_db import utc_now
        with conn:  # commit/rollback
            conn.execute(
                "INSERT OR IGNORE INTO compass_weights "
                "(level_id, w_consistency, w_magnitude, dd_ceiling, cvar_floor, "
                " learned, updated_at) VALUES (0, ?, ?, ?, ?, 0, ?)",
                (w_consistency, w_magnitude, dd_ceiling, cvar_floor, utc_now()),
            )
        row = _read_compass_weights(conn, 0)
    finally:
        if own_conn:
            conn.close()
    return row


if __name__ == "__main__":
    # Guarded smoke — NEVER runs on import, and only when the compass is
    # explicitly enabled. Pure functions need no flag; this guards the auto-run.
    import os

    if os.environ.get(TRAINER_COMPASS_ENABLED_ENV, "").strip().lower() in (
        "1", "true", "yes", "on"
    ):
        print("cvar_95([-5,-3,-1,0,1,2,3,4,5]) =", cvar_95([-5, -3, -1, 0, 1, 2, 3, 4, 5]))
        print("sortino([0.01,-0.02,0.03,-0.01,0.02]) =",
              sortino([0.01, -0.02, 0.03, -0.01, 0.02]))
        print("n_eff_bets([1,1,1,1]) =", n_eff_bets([1, 1, 1, 1]))
        print("per_eff_bet_net(mixed) =", per_eff_bet_net([
            {"pnl_usd": 10.0, "original_notional_usd": 1000.0, "ticker": "BTC"},
            {"pnl_usd": 5.0, "original_notional_usd": None, "ticker": "ETH"},
        ]))
    else:
        print(f"{TRAINER_COMPASS_ENABLED_ENV} not set — compass smoke inert.")
