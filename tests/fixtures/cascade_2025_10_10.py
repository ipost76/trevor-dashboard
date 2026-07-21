#!/usr/bin/env python3
"""The 2025-10-10 intraday cascade — the reference stress the CVaR gate exists to
catch. Deterministic, no randomness.

The masked-wick data R6-A1 corrected (validated against BTC): PAXG wicked
−23.6% and ZEC −41.8% INTRADAY, then recovered toward the close. A close-based
series masks the wick — which is the whole reason the compass needs a left-tail
(CVaR) gate ON TOP OF a max-drawdown gate. The raw intraday price paths are
carried here (not the daily closes) so the wick magnitudes are computed FROM the
path, not asserted blind.

This fixture supplies a `cascade_candidate()` — a config exposed to the cascade —
whose CLOSE-BASED equity curve clears the DD ceiling (a DD-average misses the
wick) while its per-trade net-PnL series carries the −41.8% / −23.6% blowups the
CVaR floor rejects. The calibration test (test_cascade_calibration.py) proves
both halves.
"""
from typing import Any, Dict, List

# --------------------------------------------------------------------------
# Raw intraday price paths (open -> ... -> intraday LOW -> ... -> close).
# The low is the wick; the close is where a daily-close series would land.
# --------------------------------------------------------------------------
PAXG_PATH: List[float] = [100.0, 98.0, 92.0, 84.0, 76.4, 82.0, 90.0, 95.0]
ZEC_PATH: List[float] = [100.0, 95.0, 80.0, 65.0, 58.2, 70.0, 85.0, 92.0]
# Majors were roughly flat that day (BTC-validated) — small intraday moves.
BTC_PATH: List[float] = [100.0, 99.5, 99.0, 98.5, 99.0, 99.5, 100.0, 100.5]
ETH_PATH: List[float] = [100.0, 99.0, 98.5, 98.0, 98.5, 99.0, 99.5, 100.0]
SOL_PATH: List[float] = [100.0, 99.5, 99.0, 98.0, 98.5, 99.0, 99.5, 99.5]


def intraday_low_return(path: List[float]) -> float:
    """Return of the intraday LOW vs the open — the wick magnitude."""
    return (min(path) - path[0]) / path[0]


def close_return(path: List[float]) -> float:
    """Return of the close vs the open — what a daily-close series sees."""
    return (path[-1] - path[0]) / path[0]


# The wick magnitudes, computed from the paths (the assert targets).
PAXG_WICK = intraday_low_return(PAXG_PATH)   # -0.236
ZEC_WICK = intraday_low_return(ZEC_PATH)     # -0.418

# --------------------------------------------------------------------------
# Per-trade net-PnL series (what the CVaR gate sees). 38 normal trades + the
# two cascade wick trades (positions stopped/liquidated at the intraday low).
# A normal, modestly-positive book: none of the 38 breaches the tail, so the
# worst-5% is exactly the two wicks. 40 obs -> cvar cutoff = int(40*.05) = 2.
# --------------------------------------------------------------------------
def cascade_net_pnl_series() -> List[float]:
    normal = ([0.03] * 19) + ([-0.02] * 19)          # 38 trades, sum = +0.19
    wicks = [ZEC_WICK, PAXG_WICK]                     # the -41.8% / -23.6% blowups
    return normal + wicks                            # 40 total


# --------------------------------------------------------------------------
# CLOSE-BASED equity curve (what a daily-close backtest's DD sees). The cascade
# day's portfolio CLOSE return is a shallow blend of the recovered closes, so
# the drawdown is tiny — a DD-average MISSES the intraday cascade.
#   peak 102.0 -> cascade close 99.35  =>  frac dd = 2.65/102 = 0.026
# --------------------------------------------------------------------------
def close_based_equity_curve() -> List[float]:
    return [100.0, 100.5, 101.2, 102.0, 99.35, 100.1, 101.3]


# --------------------------------------------------------------------------
# INTRADAY (honest) equity curve — same book marked to the intraday LOW on the
# cascade day. Even this HONEST curve only shows ~13.7% portfolio drawdown,
# because a portfolio-blended average dilutes a single-asset wick. That is the
# deepest reason the CVaR gate is needed: NO drawdown metric (not even the
# honest intraday one) surfaces the −41.8% single-asset blowup that CVaR on the
# per-trade distribution catches.
#   peak 102.0 -> cascade intraday 88.05  =>  frac dd = 13.95/102 = 0.1368
# --------------------------------------------------------------------------
def intraday_equity_curve() -> List[float]:
    return [100.0, 100.5, 101.2, 102.0, 88.05, 100.1, 101.3]


def cascade_candidate() -> Dict[str, Any]:
    """A config exposed to the 2025-10-10 cascade, as the trainer's candidate
    simulator would present it: a CLOSE-BASED equity curve (the realistic
    backtest input) + an intraday-aware per-trade net-PnL series. Also carries
    a benign daily-return + trade set so that, if it ever cleared the wall, it
    would be scorable — but it MUST be rejected at the survival wall by the
    CVaR gate."""
    return {
        "equity_curve": close_based_equity_curve(),
        "net_pnl_series": cascade_net_pnl_series(),
        "daily_returns": [0.005, -0.004, 0.006, -0.003, 0.004, -0.002, 0.005],
        "trades": [
            {"pnl_usd": 12.0, "original_notional_usd": 1000.0, "ticker": "BTC"},
            {"pnl_usd": 9.0, "original_notional_usd": 1000.0, "ticker": "ETH"},
        ],
    }
