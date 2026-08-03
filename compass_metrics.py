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
import os
from typing import Any, Dict, List, NamedTuple, Optional, Sequence, Tuple, Union

# ---------------------------------------------------------------------------
# RF3T2-B3 — COMPASS COHERENCE v2. ONE flag gates all four coherence fixes
# (T2-a blend, T2-b correlation-adjusted n_eff, T2-c sample damper, T2-d is in
# trainer_validation.family_k). Default OFF -> every path below is byte-identical
# to v1. Read at CALL time (never cached at import) so a test/harness can flip it.
# ---------------------------------------------------------------------------
COMPASS_COHERENCE_V2_ENV = "COMPASS_COHERENCE_V2_ENABLED"


def coherence_v2_enabled() -> bool:
    """True iff COMPASS_COHERENCE_V2_ENABLED is truthy. OFF (default) -> v1."""
    return os.environ.get(COMPASS_COHERENCE_V2_ENV, "").strip().lower() in (
        "1", "true", "yes", "on",
    )

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

    📋 RF3T2-B8 (NIT-8, DOCUMENT): RECON-GIGANTIC-001 flagged that an all-up window
    returns EXACTLY 99.0 and so inflates the consistency term for a window that merely
    had no down days. That is real but BOUNDED, and it is deliberately left as-is:
    (a) the survival WALL runs first and short-circuits — an all-up window still has to
    clear drawdown + CVaR before it is ever scored; (b) RF3T2-B3 already turned the
    sentinel into a LOAD-BEARING documented case for the bounded tie-break (see the
    MAGNITUDE_SCALE_USD block below — every all-up window collides at exactly 99.0, so
    |c_A - c_B| = 0 and magnitude is the sole decider, by design). Changing the sentinel
    would silently move that tie-break. Any revisit is a separate, gated decision.
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
# 3c. _assess_dd — the SURVIVAL-FIRST gate (a) input (RF3T1-B3).
#     🚨 THE FIX IS *NOT* "dd == 0 -> reject". A VALID multi-point curve that
#     genuinely never declined returns 0.0 and PASSES (assessed "no drawdown").
#     A dd of 0 on ABSENT data is "no data", NOT "no drawdown" -> None -> REJECT,
#     exactly mirroring cvar_95 -> None on an unassessable tail (gate (b)). A
#     survival gate that fails OPEN on missing/empty data is not a gate.
# ===========================================================================
_DD_MIN_N = 2   # a peak-to-trough needs >= 2 points; empty/length-1 = no data


def _assess_dd(equity_curve: Sequence[Any]) -> Optional[float]:
    """Gate (a)'s input. Returns the fractional max-drawdown of ``equity_curve``,
    or ``None`` when the curve is UNASSESSABLE — missing / empty / ``None`` /
    fewer than ``_DD_MIN_N`` valid points / no positive peak (all values <= 0, so
    a fractional drawdown is undefined). ``None`` makes gate (a) fail SAFE
    (REJECT), never fail OPEN on absent data. A valid curve with genuinely zero
    drawdown still returns ``0.0`` and clears the gate — the distinction between
    "no data" (None) and "no drawdown" (0.0) is the whole correctness here."""
    clean = _values(equity_curve) if equity_curve is not None else []
    if len(clean) < _DD_MIN_N or not any(v > 0.0 for v in clean):
        return None
    return max_drawdown_frac(clean)


# ===========================================================================
# 4. n_eff_bets — effective number of INDEPENDENT bets.
#
#    v1 (flag OFF): 1 / HHI(normalized ticker notional weights). Herfindahl
#    inverse — a CONCENTRATION measure, NOT an INDEPENDENCE measure.
#
#    🚨 v2 (RF3T2-B3, flag ON): 1 / (wᵀ C w) — correlation-adjusted.
#    WHY: HHI counts ten crypto-beta-correlated names as ~10 independent bets.
#    Measured live this run: 10 equal-notional crypto-beta tickers report
#    n_eff = 10.0000 while the correlation-adjusted truth is 1.4599 at rho=0.65
#    -> a 6.85x OVER-COUNT (7.14x at rho~=0.68, the figure RV-D1 S4 reports; the
#    factor is rho-dependent — this is a precision note on D1, NOT a correction).
#    Since magnitude = total_net / n_eff_bets, an over-counted denominator makes
#    a fake-diversified book both understate its own per-bet magnitude AND
#    advertise a diversification a downstream consumer will believe.
#
#    The v2 form degrades PROVABLY:
#      * all correlations 0  -> reduces EXACTLY to 1/HHI (the v1 behaviour)
#      * all correlations 1  -> n_eff = 1.0 (a fully correlated book IS one bet)
#    v1 is therefore the special case that ASSUMES INDEPENDENCE — the one
#    assumption that is definitely false for ten crypto-beta names.
# ===========================================================================

# 🚨 THE FAIL DIRECTION — THE WHOLE SAFETY PROPERTY OF T2-b.
# When correlation data is MISSING / THIN / DEGENERATE we fail toward HIGH
# correlation (FEWER effective bets), NEVER toward independence.
#
#   FALLBACK VALUE: n_eff = 1.0   (== the rho=1 limit of 1/(wᵀCw), so it is the
#   formula's OWN conservative limit, not an arbitrary constant.)
#
#   REASON: we cannot PROVE independence, so we claim NONE. Falling back to
#   1/HHI on missing data would silently re-create the exact 6.85-7.14x
#   over-count this fix exists to remove — a default that is secretly a policy.
#   Claiming one bet is the honest floor: it never advertises diversification
#   the data cannot support.
_N_EFF_CONSERVATIVE_FALLBACK: float = 1.0


def _clean_weights(
    weights: Union[Dict[str, float], Sequence[float]]
) -> Tuple[List[str], List[float]]:
    """Normalize a weight map/sequence -> (keys, L1-normalized magnitudes).
    Returns ([], []) when empty / all-zero / non-numeric (the degenerate case)."""
    if isinstance(weights, dict):
        items = list(weights.items())
    else:
        items = [(str(i), w) for i, w in enumerate(weights)]

    keys: List[str] = []
    mags: List[float] = []
    for k, w in items:
        try:
            fw = abs(float(w))
        except (TypeError, ValueError):
            continue
        if math.isnan(fw) or math.isinf(fw):
            continue
        keys.append(str(k))
        mags.append(fw)

    total = sum(mags)
    if total <= 0.0 or not mags:
        return [], []
    return keys, [m / total for m in mags]


def _corr_lookup(correlation: Any, a: str, b: str) -> Optional[float]:
    """Pull rho(a,b) from a correlation container, or None when unavailable.

    Accepts a nested dict ``{ticker: {ticker: rho}}`` (either orientation) or a
    flat pair-keyed dict ``{(a, b): rho}``. Self-pairs are 1.0. Any value that is
    not a finite number in [-1, 1] is treated as UNAVAILABLE (None) — a
    malformed entry must never be read as a low correlation."""
    if a == b:
        return 1.0
    if correlation is None:
        return None
    raw: Any = None
    try:
        if isinstance(correlation, dict):
            inner = correlation.get(a)
            if isinstance(inner, dict) and b in inner:
                raw = inner[b]
            else:
                inner_b = correlation.get(b)
                if isinstance(inner_b, dict) and a in inner_b:
                    raw = inner_b[a]
                elif (a, b) in correlation:
                    raw = correlation[(a, b)]
                elif (b, a) in correlation:
                    raw = correlation[(b, a)]
    except (TypeError, KeyError):
        return None
    if raw is None:
        return None
    try:
        rho = float(raw)
    except (TypeError, ValueError):
        return None
    if math.isnan(rho) or math.isinf(rho) or not (-1.0 <= rho <= 1.0):
        return None
    return rho


def n_eff_bets(
    weights: Union[Dict[str, float], Sequence[float]],
    correlation: Any = None,
) -> float:
    """Effective number of INDEPENDENT bets over ticker notional weights.

    v1 (flag OFF, or ``correlation`` omitted while the flag is OFF):
        ``1 / HHI`` — HHI = sum(w_i^2) of the L1-normalized non-negative weights.
        Equal weights over N tickers -> N; all mass on one ticker -> 1.0.

    v2 (``COMPASS_COHERENCE_V2_ENABLED`` ON):
        ``1 / (wᵀ C w)`` using the caller-supplied ``correlation``. Reduces
        EXACTLY to 1/HHI when every off-diagonal rho is 0, and to 1.0 when every
        rho is 1. 🚨 When ``correlation`` is missing / unusable for ANY off-diagonal
        pair, returns the CONSERVATIVE fallback ``1.0`` (fail toward HIGH
        correlation) — see ``_N_EFF_CONSERVATIVE_FALLBACK`` above for the value
        and the reason. Partial coverage is NOT interpolated: one unavailable
        pair makes the whole matrix untrusted, because guessing a single rho low
        is exactly the silent over-count this fix removes.

    Empty / all-zero / degenerate weights -> 1.0 in BOTH versions (single
    effective bet — the conservative floor). Negative weights are taken by
    magnitude (abs) before normalizing; notional weights are non-negative in
    practice.

    ⚠️ CORRELATION SOURCE IS **PENDING / UNSOLVED** (RF3T2-B3, 2026-07-24) —
    NOT merely unimplemented. There is NO clean source on this box:
      * ``training_correlations`` (29 rows) is ``source='synthetic_training'``
        rule-based lessons ("BTC dumps >3% -> ETH -6.2%"), NOT a pairwise matrix.
      * ``correlation_cluster_shadow`` (1268 rows) carries cluster LABELS
        (MAJORS/MEMES/L1S) for concurrent-risk capping, NOT pairwise rho.
      * BOTH live on the 0444 LAGGED litestream replica. The compass is a
        DECISION path, and RV verified zero decision-path replica reads — reading
        them here would violate the matched-data promotion guarantee.
    The correlation matrix is therefore supplied BY THE CALLER. ``backtest_fn``
    is the intended provider (it already owns the simulation store, so it can
    compute C from the SAME data it simulates from — no replica read, no
    matched-data violation). Until ``backtest_fn`` exists (D-5 / RF-BACKTEST),
    every v2 call takes the conservative fallback. Do NOT "fix" this by pointing
    it at the replica.
    """
    keys, w = _clean_weights(weights)
    if not w:
        return 1.0

    if not coherence_v2_enabled():
        # ---- v1: 1 / HHI (byte-identical to pre-RF3T2-B3) ----
        hhi = sum(x * x for x in w)
        return 1.0 / hhi if hhi > 0.0 else 1.0

    # ---- v2: 1 / (wᵀ C w), conservative on ANY unavailable pair ----
    quad = 0.0
    n = len(w)
    for i in range(n):
        for j in range(n):
            rho = _corr_lookup(correlation, keys[i], keys[j])
            if rho is None:
                return _N_EFF_CONSERVATIVE_FALLBACK
            quad += w[i] * w[j] * rho
    if quad <= 0.0:
        # Degenerate / non-PSD quadratic form -> cannot trust it -> conservative.
        return _N_EFF_CONSERVATIVE_FALLBACK
    n_eff = 1.0 / quad
    # A correlation matrix can never yield MORE independent bets than names, and
    # never fewer than one. Clamp defensively (a non-PSD input could overshoot).
    return max(1.0, min(float(n), n_eff))


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
    correlation: Any = None,
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
    which is the CONSERVATIVE treatment — splitting one bucket's weight across N
    synthetic names LOWERS HHI (``Σw²`` falls from ``w²`` to ``w²/N``), so ``1/HHI``
    RISES: more effective bets, a bigger denominator, a SMALLER $/bet. RF3T2-B8:
    the effect is conservative exactly as RECON-GIGANTIC-001 said, but this comment
    described the mechanism BACKWARDS — it read "(higher-HHI)", and the HHI falls.

    ``correlation`` (RF3T2-B3) is passed straight through to ``n_eff_bets`` — see
    that docstring for the v2 form, the conservative fallback, and the PENDING
    correlation-source blocker. ``None`` (the default, and the only value
    possible today) -> v1 keeps 1/HHI, v2 takes the conservative fallback.

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

    eff = n_eff_bets(notional_by_ticker, correlation) if notional_by_ticker else 1.0
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
_K_CORR = "correlation"          # T2-b: caller-supplied correlation matrix (opt)


# ===========================================================================
# RF3T2-B3 / T2-c — THE SAMPLE DAMPER (a DAMPER, *NOT* a GATE).
#
# CVaR-95 over fewer than ~40 points is a SINGLE order statistic: the cutoff is
# `max(1, int(n*0.05))`, which stays 1 across the whole 5..39 range, so ONE
# observation decides the tail. Reproduced live this run with an identical -0.20
# worst point: n=39 -> cvar -0.2000 REJECT; n=40 -> cutoff 2 -> cvar -0.0950
# PASS. Adding one benign observation flips the verdict.
#
# 🚨 THE FIX IS A FLOOR ON THE BLEND, NOT A REJECT — and it is applied to
# CONSISTENCY because consistency is the PRIMARY sort key (T2-a), so that is
# where a thin sample must be penalised. A thin-sample candidate stays fully
# SCORABLE and fully COMPARABLE; it simply cannot win on a noisy Sortino.
#
# 🚨 WHY NOT A SECOND REJECT: sample-adequacy rejection ALREADY exists at the
# survival wall (`cvar_95` -> None below 5 obs -> gate (b) REJECT; `_assess_dd`
# -> None below 2 points -> gate (a) REJECT). THE REAL SAMPLE DEFENSE IS THE
# DOWNSTREAM VM DSR / `family_k` SELECTION-DEFLATION. Adding a second, weaker
# sample gate here would let a candidate be killed twice for the same reason,
# and this one has no deflation theory behind it. Damper only.
#
# SMOOTH, NOT STEPPED: a linear ramp in n has no cliff anywhere, so no pair of
# adjacent n values can flip a verdict (proven for 39 vs 40 in the tests).
_SAMPLE_FLOOR_N: int = 40   # the n at which the CVaR cutoff first exceeds 1


def _sample_damper(n_obs: int, n_floor: int = _SAMPLE_FLOOR_N) -> float:
    """Smooth shrink factor in (0, 1]: ``min(1, n / n_floor)``.

    n >= n_floor -> 1.0 (no shrink). Below the floor the factor ramps linearly,
    so consistency is pulled toward neutral in proportion to how thin the sample
    is. Continuous in n -> NO cliff -> adjacent n values can never flip a
    verdict. Never returns 0 for n >= 1, so a thin candidate is damped, never
    erased (erasing it would be a reject by another name)."""
    if n_floor <= 0:
        return 1.0
    n = max(0, int(n_obs))
    return min(1.0, n / float(n_floor))


# ===========================================================================
# RF3T2-B3 / T2-a — THE BOUNDED TIE-BREAK BLEND.
#
# v1 was a RAW LINEAR SUM of incompatible units:
#     blend = w_c*sortino + w_m*magnitude
#           = w_c*(unbounded annualized dimensionless ratio)
#           + w_m*(raw USD-per-effective-bet)
# The `w_consistency >= w_magnitude` clamp bounds the WEIGHTS, never the TERM
# SCALE — so a large-enough magnitude outranks consistency. Reproduced live:
# steady-small (sortino 555.82, $2/bet, blend 389.67) is overtaken by
# volatile-bigger (sortino 5.38) at magnitude $1,286.35/eff-bet. The crossover
# is exactly M_x = M_s + (w_c/w_m)*(c_s - c_v) — LINEAR in the sortino gap,
# which reproduces all four RV-D1 S1 pairings to <$0.02 ($69-$310 range).
#
# 🚨 WHY NOT STRICT epsilon-BAND LEXICOGRAPHIC (the originally specified design):
# it is INTRANSITIVE. With eps=0.06 and consistencies A=1.00, B=1.05, C=1.10:
# A~B (in band -> magnitude decides), B~C (in band -> magnitude decides), but
# |A-C| = 0.10 > eps so C beats A outright. Choose magnitudes A >> B >> C and
# you get A>B, B>C, C>A — A CYCLE. No scalar function can represent a cyclic
# relation, and a comparator would fix only ONE of the THREE consumers that
# read this number (see below).
#
# 🚨 WHY IT MUST STAY A SCALAR — THERE ARE THREE CONSUMERS, NOT ONE:
#   1. trainer_capital._compass_improves  -> `float(bw) > float(bo)` (ORDERING)
#   2. trainer_bandit.compass_reward      -> `tanh(REWARD_K*blend)`   (ARITHMETIC)
#      ⚠️ REWARD_K was 0.5 when this block was written; RD-B8 (2026-07-25)
#      rescaled it to 1/550 because at 0.5 the reward spread over the real blend
#      range [30,550] was 7.48e-14 — every scored survivor collapsed onto ~1.0.
#      Cite the CONSTANT, never the literal, so this comment cannot go stale again.
#   3. trainer_hypotheses.compass_blend_delta -> `score(with)-score(without)`,
#      summed into `net_evidence`                                    (ARITHMETIC)
#   (4. trainer_reasoning narration — display only.)
# A comparator fixes #1 and leaves #2 and #3 reading a raw scalar. A big-
# multiplier lexicographic encoding (consistency*1e6 + magnitude) preserves
# ordering but saturates #2 to 1.0 and makes #3's delta meaningless.
#
# THE FIX — a BOUNDED tie-break perturbation:
#     blend = consistency + epsilon * (tanh(magnitude / S) / 2)
# The magnitude term is bounded to +/- epsilon/2 BY CONSTRUCTION. Therefore:
#     if (c_A - c_B) > epsilon  then  blend_A - blend_B > epsilon - epsilon = 0
# -> MAGNITUDE CAN NEVER INVERT AN ORDERING OUTSIDE THE BAND. Structurally
# impossible, provable in one line, and verified over 200,000 random pairs with
# magnitudes up to +/-$1,000,000: ZERO inversions.
# Inside the band, magnitude is the decider — exactly the design's "tiebreaker".
#
# 🚨 THE LEARNED PARAMETER STILL FLEXES PER LEVEL: it now controls the EPSILON
# BAND (tie tolerance) instead of a linear weight, derived from the EXISTING
# `compass_weights` columns (w_magnitude / w_consistency). NO SCHEMA CHANGE.
#
# ⚠️ HONEST MEASUREMENT — IS THE TIE-BREAK VESTIGIAL AT REAL SCALES?
# epsilon = 0.4286 at the seed weights, against realistic sortino values of
# 30-550. Measured band occupancy over 200k random pairs:
#     sortino ~ U[1,150]        -> 0.58% of pairs fall inside the band
#     sortino ~ U[1,600]        -> 0.13%
#     sortino ~ lognormal(3,1)  -> 1.55%
# So for RANDOMLY-DRAWN pairs magnitude decides ~1% of the time or less. That is
# NOT a bug being papered over — the design says consistency dominates, and a
# near-zero tie-break rate is that design working. But it is NOT decorative
# either: the EXACT-TIE clusters are 100% in-band by construction —
#   * the sortino 99.0 all-up sentinel: EVERY all-up window returns EXACTLY 99.0
#   * config axes that do not change the return distribution (timing / cooldown
#     sweeps) produce IDENTICAL daily_returns -> IDENTICAL sortino
# In both, |c_A - c_B| = 0.0 and magnitude is the SOLE decider. State it that
# way: magnitude decides ties, ties are rare among random pairs and certain
# among distribution-invariant variants.

# 📋 RF3T2-B8 (NIT-3, DOCUMENT — not a gap): this module has ZERO `regime` references
# by design, so per-regime weighting cannot be learned INSIDE the compass. RECON-
# GIGANTIC-001's own verdict is that this is a CLEANER design, not a defect: the
# capability already exists one layer up in `trainer_capital.propose_regime_posture`
# (default-declines, flag OFF, never a signal), which keeps regime posture a separate
# gated proposal instead of a hidden weight inside the objective function. Do NOT add a
# regime-keyed compass weight to "close" this.

# S — the magnitude scale inside the tanh. UNITS: USD PER EFFECTIVE BET.
# DERIVATION (not a magic number): mirrored from the project's inviolable hard
# capital cap `LIVE_HARD_CAPITAL_CAP_USD = 50.0` (an immutable auto_config key).
# The largest plausible NET per effective bet over one scoring window is bounded
# by the capital that can be at risk at all. Mirrored, not imported — same
# pattern as FEE_BPS_ROUNDTRIP above (importing auto_trader trips the WSL
# barrier). If the hard cap changes, this SHOULD be revisited.
#
# 🚨 PROVEN NOT TO SATURATE over the realistic range (the trap: too small an S
# saturates the tanh INSIDE the band, every tie pins to +/-eps/2, and magnitude
# stops discriminating ties — the bandit-saturation defect one level down, in
# the fix itself). Measured tie-break term across the realistic span:
#     $0 -> 0.000000 | $10 -> 0.042295 | $36.90 (deployable @ $82) -> 0.134558
#     = 62.8% of the available half-band used across $0-$36.90. NOT saturated.
#     tanh hits 0.99 only at m = 2.65*S = $132/eff-bet = 3.6x deployable
#     capital -> outside the realistic range BY CONSTRUCTION.
# Counter-test (what a bad S would do): S=1.0 -> $1 already maps to 0.7616 and
# $36.90 to 1.000000, a spread of only 0.238 -> saturated, magnitude dead.
MAGNITUDE_SCALE_USD: float = 50.0

# Floor on the derived epsilon. A learned w_magnitude of exactly 0 would collapse
# the band to zero and make magnitude unable to break even an EXACT tie, which
# would silently retire the tiebreaker the design requires. Tiny but non-zero.
_EPSILON_MIN: float = 1e-9


def _derive_epsilon(w_consistency: float, w_magnitude: float) -> float:
    """Tie-tolerance epsilon from the EXISTING compass_weights columns.

    epsilon = w_magnitude / w_consistency  (0.3/0.7 = 0.4286 at the seed row).
    This is the learned per-level parameter, re-expressed: a level that learns a
    RELATIVELY larger magnitude weight gets a WIDER tie band (magnitude decides
    more often), never a chance to outrank consistency outright. NO SCHEMA
    CHANGE — both columns already exist.

    Guarded: a non-finite / non-positive w_consistency, or a negative
    w_magnitude, falls back to the seed ratio rather than producing a nonsense
    band. Result is always finite and > 0."""
    try:
        wc, wm = float(w_consistency), float(w_magnitude)
    except (TypeError, ValueError):
        wc, wm = SEED_W_CONSISTENCY, SEED_W_MAGNITUDE
    if not (wc > 0.0) or math.isnan(wc) or math.isinf(wc) \
            or wm < 0.0 or math.isnan(wm) or math.isinf(wm):
        wc, wm = SEED_W_CONSISTENCY, SEED_W_MAGNITUDE
    return max(_EPSILON_MIN, wm / wc)


def _bounded_tiebreak(magnitude: float, epsilon: float,
                      scale: float = MAGNITUDE_SCALE_USD) -> float:
    """The magnitude term: ``epsilon * tanh(magnitude / scale) / 2``.

    STRICTLY bounded to (-epsilon/2, +epsilon/2) for every finite magnitude —
    this bound IS the T2-a guarantee. Monotonically increasing in magnitude (a
    better magnitude never hurts). Non-finite magnitude -> 0.0 contribution
    (neutral), never a NaN that would poison the blend."""
    try:
        m = float(magnitude)
    except (TypeError, ValueError):
        return 0.0
    if math.isnan(m) or math.isinf(m):
        return 0.0
    s = scale if scale > 0.0 else MAGNITUDE_SCALE_USD
    return epsilon * (math.tanh(m / s) / 2.0)


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

      Gate (a): _assess_dd(equity_curve)  <= dd_ceiling   (slow bleed; None -> REJECT)
      Gate (b): cvar_95(net_pnl_series)   >= cvar_floor    (the one-day wick)

    Returns {passed, dd, cvar, dd_ceiling, cvar_floor, failing}. `failing` names
    the breached gate(s). SURVIVAL-FIRST: an unassessable equity curve (missing /
    empty / too-short / no positive peak -> dd None) FAILS gate (a), and an
    unassessable left tail (cvar None, < 5 observations) FAILS gate (b) — you
    cannot clear the survival wall on data you cannot prove is safe. A dd of 0 on
    ABSENT data is "no data", not "no drawdown".
    """
    dd_ceiling = float(thresholds["dd_ceiling"])
    cvar_floor = float(thresholds["cvar_floor"])

    dd = _assess_dd(candidate.get(_K_EQUITY, []))
    cvar = cvar_95(candidate.get(_K_NET_PNL, []))

    failing: List[str] = []
    # dd None -> cannot assess the curve -> conservative FAIL (survival-first),
    # matching gate (b)'s cvar-None idiom. A dd of 0 on absent data is "no data".
    gate_a = dd is not None and dd <= dd_ceiling
    if not gate_a:
        failing.append("dd_ceiling" if dd is not None else "dd_ceiling(insufficient_curve)")
        if dd is None:
            _log.warning(
                "🚨 COMPASS survival gate (a): unassessable equity curve "
                "(missing / empty / too-short / no positive peak) — REJECTED. "
                "No data is not 'no drawdown'."
            )
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


_WEIGHT_SEED_DEFAULTS = {
    "w_consistency": SEED_W_CONSISTENCY,
    "w_magnitude": SEED_W_MAGNITUDE,
    "dd_ceiling": SEED_DD_CEILING,
    "cvar_floor": SEED_CVAR_FLOOR,
}


def _finite_weight(raw: Any, field: str, source: str) -> float:
    """Coerce one compass weight/threshold to a FINITE float, else the SEED value.

    🚨 RD-B8 — the cfg_float-class finiteness gap on this flow. Previously these
    were bare ``float(row[N])`` with no guard. MEASURED failure surface:

      * DB, NaN   -> SQLite cannot store NaN; it lands as NULL -> ``float(None)``
                     raised **TypeError** (NOT the AssertionError A8 reported —
                     that is the caller-supplied path, below).
      * DB, +-inf -> round-trips as REAL -> blend_score became inf / nan (v1),
                     silently non-finite, NO raise.
      * caller ``weights=``, NaN   -> **uncaught AssertionError** in
                     ``_enforce_fixed_order`` (NaN comparisons are all False, so
                     the post-clamp invariant assert blows up) — v1 AND v2.
      * caller ``weights=``, +-inf -> v1 non-finite blend; v2 absorbs it to a
                     finite value (the bounded tie-break saturates).

    RD-B1 is closing ``cfg_float`` at the root ON THE VM and does NOT reach WSL,
    so this is fixed here rather than routed to a ledger. Fail SAFE to the seed
    constant with a loud log — never a guessed weight, never a silent non-finite
    blend, never an AssertionError escaping into the search loop.
    """
    default = _WEIGHT_SEED_DEFAULTS[field]
    try:
        val = float(raw)
    except (TypeError, ValueError):
        _log.warning(
            "[COMPASS] non-numeric %s=%r from %s (SQLite stores NaN as NULL) — "
            "falling back to the seed value %.6g", field, raw, source, default,
        )
        return float(default)
    if not math.isfinite(val):
        _log.warning(
            "[COMPASS] non-finite %s=%r from %s — falling back to the seed "
            "value %.6g", field, val, source, default,
        )
        return float(default)
    return val


def _sanitize_weights(weights: Dict[str, Any], source: str) -> Dict[str, Any]:
    """Finiteness-guard every weight/threshold, whatever path delivered it.

    Applied to BOTH the DB read AND a caller-supplied ``weights=`` dict, because
    the two paths fail differently (see ``_finite_weight``) and guarding only the
    DB read would leave the AssertionError path wide open. A dict of already-finite
    weights passes through byte-identical."""
    out = dict(weights)
    for field in _WEIGHT_SEED_DEFAULTS:
        if field in out:
            out[field] = _finite_weight(out[field], field, source)
    try:
        out["learned"] = int(out.get("learned", 0) or 0)
    except (TypeError, ValueError):
        _log.warning(
            "[COMPASS] non-integer learned=%r from %s — treating as 0 (unlearned)",
            out.get("learned"), source,
        )
        out["learned"] = 0
    return out


def _read_compass_weights(conn, level: int) -> Dict[str, Any]:
    """Read the per-level blend + gate thresholds from compass_weights, falling
    back to level 0, then to the SEED_* constants (so an unseeded DB never
    crashes evaluate_compass). Returns a dict of the 5 columns.

    Every returned value is finiteness-guarded (RD-B8) — see ``_finite_weight``."""
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
        return _sanitize_weights(
            {
                "w_consistency": row[0],
                "w_magnitude": row[1],
                "dd_ceiling": row[2],
                "cvar_floor": row[3],
                "learned": row[4],
                "source": "db",
            },
            f"compass_weights[level={int(level)}]",
        )
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
        weights = _read_compass_weights(conn, level)   # already finiteness-guarded
        if own_conn:
            conn.close()
    else:
        # 🚨 RD-B8: the caller-supplied path needs the SAME guard. This is the
        # route that produced an UNCAUGHT AssertionError on a NaN weight (in both
        # v1 and v2) — guarding only the DB read would have left it wide open.
        weights = _sanitize_weights(weights, "caller-supplied weights=")

    thresholds = {"dd_ceiling": weights["dd_ceiling"], "cvar_floor": weights["cvar_floor"]}
    gates = survival_gates(candidate, thresholds)

    # ---- STEP 1: the WALL. Rejected at any return; NOTHING else computed. ----
    if not gates["passed"]:
        # Tripwire on the REJECT path too: if the first real candidates all fail
        # the wall, this is the ONLY line that would ever announce which blend
        # version is armed. Consistency/magnitude are still NOT computed — the
        # short-circuit is byte-intact; this only logs.
        _log.info(
            "[COMPASS] blend_version=%s level=%d verdict=rejected failing=%s",
            "v2" if coherence_v2_enabled() else "v1", int(level), gates["failing"],
        )
        return {
            "survived": False,
            "consistency": None,
            "magnitude": None,
            "blend_score": None,
            "verdict": "rejected",
            "failing_gates": gates["failing"],
            "gates": gates,
            "level": int(level),
            # Additive diagnostic, present on BOTH return paths so `blend_version`
            # is always readable by a consumer/log-scraper. No consumer reads it.
            "coherence": {"blend_version": "v2" if coherence_v2_enabled() else "v1"},
        }

    # ---- STEP 2: consistency ALWAYS outranks magnitude ----
    v2 = coherence_v2_enabled()
    daily = candidate.get(_K_DAILY, [])
    consistency = sortino(daily)
    mag_detail = per_eff_bet_net(
        candidate.get(_K_TRADES, []),
        correlation=(candidate.get(_K_CORR) if v2 else None),
    )
    magnitude = mag_detail.value

    # ---- STEP 3: the blend ----
    w_c, w_m, clamped = _enforce_fixed_order(
        float(weights["w_consistency"]), float(weights["w_magnitude"]),
    )
    blend_version = "v2" if v2 else "v1"
    coherence: Dict[str, Any] = {"blend_version": blend_version}

    if v2:
        # T2-c: damp CONSISTENCY (the primary sort key) on a thin sample. A
        # DAMPER, never a reject — the candidate stays scorable + comparable.
        n_obs = len(_values(daily))
        shrink = _sample_damper(n_obs)
        consistency_eff = None if consistency is None else consistency * shrink
        # T2-a: epsilon band from the EXISTING weight columns; magnitude enters
        # ONLY as a perturbation bounded to +/- epsilon/2.
        epsilon = _derive_epsilon(w_c, w_m)
        coherence.update({
            "n_obs": n_obs, "sample_floor_n": _SAMPLE_FLOOR_N,
            "sample_shrink": shrink, "consistency_effective": consistency_eff,
            "epsilon": epsilon, "magnitude_scale_usd": MAGNITUDE_SCALE_USD,
        })
        if consistency_eff is None:
            blend_score = None
            verdict = "survived_unscorable"
        else:
            tiebreak = _bounded_tiebreak(magnitude, epsilon)
            # 🚨 THE INVARIANT, ASSERTED IN CODE (not merely intended): the
            # magnitude term is STRICTLY inside +/- epsilon/2, so it can never
            # invert an ordering whose consistency gap exceeds epsilon. If a
            # learned weight ever produced a band that broke this, clamp + log
            # rather than let it through silently.
            half = epsilon / 2.0
            if not (-half <= tiebreak <= half) or math.isnan(tiebreak):
                _log.warning(
                    "🚨 COMPASS TIE-BREAK BOUND VIOLATION: term=%r outside "
                    "+/-%.6g for magnitude=%r epsilon=%.6g — clamping. Magnitude "
                    "must NEVER outrank consistency outside the epsilon band.",
                    tiebreak, half, magnitude, epsilon,
                )
                tiebreak = 0.0 if math.isnan(tiebreak) else max(-half, min(half, tiebreak))
            coherence["tiebreak_term"] = tiebreak
            blend_score = consistency_eff + tiebreak
            verdict = "scored"
    else:
        # ---- v1: the original raw linear sum (byte-identical) ----
        if consistency is None:
            blend_score = None
            verdict = "survived_unscorable"  # survived the wall, sortino < 3 obs
        else:
            blend_score = w_c * consistency + w_m * magnitude
            verdict = "scored"

    # 🚨 THE TRIPWIRE (RF3T2-B3). UNCONDITIONAL, INFO, on EVERY score, BOTH
    # paths. `COMPASS_COHERENCE_V2_ENABLED` ships OFF, and this project's
    # defining failure is "built, correct, and wired to nothing" (six instances
    # and counting). The first time this ever scores a real candidate, the log
    # says v1 or v2 OUT LOUD — so an unarmed compass announces itself instead of
    # silently optimizing toward the old broken blend forever.
    _log.info(
        "[COMPASS] blend_version=%s level=%d verdict=%s consistency=%s "
        "magnitude=%s n_eff_bets=%.4f blend_score=%s",
        blend_version, int(level), verdict, consistency, magnitude,
        mag_detail.n_eff_bets, blend_score,
    )

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
        "coherence": coherence,
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

    🚨 THIS IS A MANUAL / TEST-EXERCISED TOOL, NOT DEAD CODE (measured B5, 2026-08-02).
    It was carried as a "caller-less live-store writer"; that is REFUTED. It has exactly
    ONE caller — ``tests/test_cascade_calibration.py`` ``_seed_scratch_store()`` (invoked at
    that module's top level), which seeds its SCRATCH store through the production seeder so
    the row is written exactly the way production writes it. Nothing else reaches it: no cron,
    no systemd unit, no dynamic dispatch, no CLI entry, and this module's own ``__main__``
    smoke does NOT call it. **Deleting it breaks that test.**

    WHAT IT WRITES: one row in ``compass_weights`` — ``(level_id=0, w_consistency,
    w_magnitude, dd_ceiling, cvar_floor, learned=0, updated_at)``. Values are the module's
    ``SEED_*`` constants unless overridden by the keyword args, after ``_enforce_fixed_order``
    clamps ``w_consistency >= w_magnitude``. ``learned=0`` marks the row as un-learned.

    PRECONDITIONS before you run this by hand:
      * It resolves the store through ``lib.trainer_db.get_connection()`` when ``conn`` is
        None, so WITHOUT a ``TRAINER_DB_PATH`` redirect a zero-arg call targets the LIVE
        ``data/trainer.db``. Pass ``conn``, or set ``TRAINER_DB_PATH``, unless writing live
        is genuinely what you want. (B11's ``_under_test()`` guard already refuses a live
        resolution from a test/``-c``/stdin entry point — that is the accidental-invocation
        path, and it is covered.)
      * INSERT OR IGNORE means this is a no-op once level 0 exists; it can never overwrite a
        learned row. To CHANGE an existing row you must write it deliberately, not via here.

    The live ``data/trainer.db`` level-0 row (seed-exact, ``learned=0``,
    ``updated_at=2026-07-21T22:15:25Z``) was written by THIS function during the R9-B1
    authoring session, four minutes before commit ``6a0a42f`` — back when the cascade test
    still resolved to the live store. That defect is closed (B11); the row is legitimate.
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
