#!/usr/bin/env python3
"""
Auto-extract cohort-level lesson cards from closed trades.

Strategy:
  1. Pull all closed trades from `unified_outcomes` with pnl_pct present.
  2. Enumerate cohort dimensions: ticker, direction, conf_bucket, regime, aggressive_mode.
  3. For every dimension subset (1..K dimensions), compute aggregate stats per
     cohort. Keep cohorts with n >= MIN_COHORT_N (default 3).
  4. Categorize each cohort into PRIORITIZE / AVOID / REGIME-DEPENDENT / ACTIVE_LEARNING.
  5. Sort by impact (sample x |expectancy|) and return top N.

NEVER mutates the DB. Pure read.

Schema notes (verified Phase 0):
  unified_outcomes is a VIEW. Columns include `confidence` and `regime` (NOT
  `confidence_at_entry` / `regime_at_entry`). Live trades have NULL confidence.
  Live trades may have NULL/empty regime. To avoid dropping data, trades with
  NULL conf/regime keep the trade record but set the bucket/regime to None;
  cohort enumeration skips tuples where any dim value is None.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import combinations
from typing import Any, Dict, Iterable, List, Optional, Tuple

DB = "/home/trevor/trevor/trevor.db"

CONF_BUCKETS: List[Tuple[float, float, str]] = [
    (35.0, 44.999, "35-44"),
    (45.0, 54.999, "45-54"),
    (55.0, 64.999, "55-64"),
    (65.0, 74.999, "65-74"),
    (75.0, 999.0,  "75+"),
]

MIN_COHORT_N = 3
PRIORITIZE_MIN_N = 10
AVOID_MIN_N = 10

PRIORITIZE_WR = 58.0
AVOID_WR = 30.0

MAX_CARDS = 30


@dataclass
class Trade:
    pnl_pct: float
    ticker: str
    direction: str
    conf_bucket: Optional[str]
    regime: Optional[str]
    aggressive_mode: Optional[bool]


def conf_to_bucket(conf: Optional[float]) -> Optional[str]:
    if conf is None:
        return None
    try:
        c = float(conf)
    except (TypeError, ValueError):
        return None
    for lo, hi, name in CONF_BUCKETS:
        if lo <= c <= hi:
            return name
    return None


def normalize_regime(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None


def fetch_trades() -> List[Trade]:
    with sqlite3.connect(DB, timeout=4.0) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT
              pnl_pct,
              ticker,
              direction,
              confidence,
              regime,
              aggressive_mode
            FROM unified_outcomes
            WHERE pnl_pct IS NOT NULL
              AND ticker IS NOT NULL
              AND direction IS NOT NULL
            """
        ).fetchall()

    out: List[Trade] = []
    for r in rows:
        agg = r["aggressive_mode"]
        if isinstance(agg, str):
            agg_norm: Optional[bool] = agg.lower() in ("true", "1", "yes")
        elif isinstance(agg, (int, bool)):
            agg_norm = bool(agg)
        else:
            agg_norm = None
        out.append(Trade(
            pnl_pct=float(r["pnl_pct"]),
            ticker=str(r["ticker"]),
            direction=str(r["direction"]),
            conf_bucket=conf_to_bucket(r["confidence"]),
            regime=normalize_regime(r["regime"]),
            aggressive_mode=agg_norm,
        ))
    return out


DIM_NAMES: Tuple[str, ...] = ("ticker", "direction", "conf_bucket", "regime", "aggressive_mode")


def active_dims(trades: List[Trade]) -> Tuple[str, ...]:
    """Return DIM_NAMES with degenerate dims removed.

    A dim is degenerate if all non-None values across the dataset are identical
    (e.g. aggressive_mode when no aggressive trades exist). Including a degenerate
    dim produces duplicate cohorts that waste MAX_CARDS slots without adding
    information. Once a second value appears (aggressive trades start arriving),
    the dim auto-re-engages.
    """
    keep: List[str] = []
    for d in DIM_NAMES:
        seen = {getattr(t, d) for t in trades if getattr(t, d) is not None}
        if len(seen) >= 2:
            keep.append(d)
    return tuple(keep)


def cohort_key(trade: Trade, dims: Tuple[str, ...]) -> Tuple[Tuple[str, Any], ...]:
    return tuple((d, getattr(trade, d)) for d in dims)


def enumerate_cohorts(trades: List[Trade], dims_pool: Tuple[str, ...]) -> Dict[Tuple[Tuple[str, ...], Tuple[Tuple[str, Any], ...]], List[Trade]]:
    """Enumerate every nonempty subset of dims_pool (1..K), group trades."""
    cohorts: Dict[Tuple[Tuple[str, ...], Tuple[Tuple[str, Any], ...]], List[Trade]] = {}
    for k in range(1, len(dims_pool) + 1):
        for dims in combinations(dims_pool, k):
            for t in trades:
                values = cohort_key(t, dims)
                cohorts.setdefault((dims, values), []).append(t)
    return cohorts


def cohort_stats(trades: List[Trade]) -> Dict[str, float]:
    n = len(trades)
    pnls = [t.pnl_pct for t in trades]
    wins = sum(1 for p in pnls if p > 0)
    losses = sum(1 for p in pnls if p < 0)
    avg_win = (sum(p for p in pnls if p > 0) / wins) if wins else 0.0
    avg_loss = (sum(p for p in pnls if p < 0) / losses) if losses else 0.0
    wr = (wins / n * 100.0) if n else 0.0
    expectancy = (sum(pnls) / n) if n else 0.0
    return {
        "trades": n,
        "win_rate_pct": round(wr, 2),
        "avg_pnl_pct": round(expectancy, 4),
        "expectancy_pct": round(expectancy, 4),
        "best_pct": round(max(pnls), 4) if pnls else 0.0,
        "worst_pct": round(min(pnls), 4) if pnls else 0.0,
        "avg_win_pct": round(avg_win, 4),
        "avg_loss_pct": round(avg_loss, 4),
    }


def categorize(stats: Dict[str, float]) -> Tuple[str, str, str, str]:
    n = stats["trades"]
    wr = stats["win_rate_pct"]
    exp = stats["expectancy_pct"]

    if n < PRIORITIZE_MIN_N and n < AVOID_MIN_N:
        return (
            "ACTIVE_LEARNING",
            f"Insufficient sample - {n} trades.",
            "Continue collecting data; do not change behavior yet.",
            "low",
        )
    if n >= PRIORITIZE_MIN_N and wr >= PRIORITIZE_WR and exp > 0:
        return (
            "PRIORITIZE",
            f"Sweet spot - {n} trades, {wr:.1f}% WR, {exp:+.2f}% avg.",
            "Prioritize this cohort.",
            "high",
        )
    if n >= AVOID_MIN_N and wr <= AVOID_WR and exp < 0:
        return (
            "AVOID",
            f"Dead zone - {n} trades, {wr:.1f}% WR, {exp:+.2f}% avg.",
            "Avoid this cohort.",
            "high",
        )
    return (
        "ACTIVE_LEARNING",
        f"Mid-ground - {n} trades, {wr:.1f}% WR, {exp:+.2f}% avg. Not categorical yet.",
        "Continue collecting data.",
        "medium",
    )


def title_for(dims: Tuple[str, ...], values: Tuple[Tuple[str, Any], ...]) -> str:
    parts: List[str] = []
    val_map = dict(values)
    if "ticker" in dims:
        parts.append(str(val_map.get("ticker")))
    if "direction" in dims:
        parts.append(str(val_map.get("direction")))
    if "conf_bucket" in dims:
        parts.append(f"conf {val_map.get('conf_bucket')}")
    if "regime" in dims:
        r = val_map.get("regime")
        if r is not None:
            parts.append(f"regime {r}")
    if "aggressive_mode" in dims:
        a = val_map.get("aggressive_mode")
        if a is not None:
            parts.append("aggressive ON" if a else "aggressive OFF")
    return " · ".join(parts) if parts else "All trades"


def cohort_id(dims: Tuple[str, ...], values: Tuple[Tuple[str, Any], ...]) -> str:
    key = json.dumps({"dims": list(dims), "values": [list(v) for v in values]}, sort_keys=True, default=str)
    return "lesson_" + hashlib.sha1(key.encode()).hexdigest()[:10]


def detect_regime_dependent(cards: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """If two siblings of one cohort (same dims sans regime) show opposite categorization,
    promote them to REGIME_DEPENDENT."""
    by_parent: Dict[str, List[Dict[str, Any]]] = {}
    for c in cards:
        cohort = c["cohort"]
        if cohort.get("regime") is None:
            continue
        parent_key = json.dumps({k: v for k, v in cohort.items() if k != "regime"}, sort_keys=True, default=str)
        by_parent.setdefault(parent_key, []).append(c)

    for siblings in by_parent.values():
        cats = {c["category"] for c in siblings}
        if "PRIORITIZE" in cats and ("AVOID" in cats or "ACTIVE_LEARNING" in cats):
            for c in siblings:
                c["category"] = "REGIME_DEPENDENT"
                c["recommendation"] = "Outcome flips by regime - gate behavior on regime."
    return cards


def build_cards(trades: List[Trade]) -> List[Dict[str, Any]]:
    dims_pool = active_dims(trades)
    cohorts = enumerate_cohorts(trades, dims_pool)
    cards: List[Dict[str, Any]] = []
    for (dims, values), cohort_trades in cohorts.items():
        if len(cohort_trades) < MIN_COHORT_N:
            continue
        if any(v is None for _, v in values):
            continue
        stats = cohort_stats(cohort_trades)
        category, conclusion, recommendation, confidence_level = categorize(stats)
        if category == "ACTIVE_LEARNING" and stats["trades"] < MIN_COHORT_N + 1:
            continue
        cohort_dict: Dict[str, Any] = {k: None for k in DIM_NAMES}
        for k, v in values:
            cohort_dict[k] = v
        cards.append({
            "id": cohort_id(dims, values),
            "category": category,
            "title": title_for(dims, values),
            "cohort": cohort_dict,
            "metric": stats,
            "conclusion": conclusion,
            "recommendation": recommendation,
            "confidence_level": confidence_level,
            "sample_size": stats["trades"],
            "note": None,
        })

    cards = detect_regime_dependent(cards)

    rank = {"PRIORITIZE": 0, "AVOID": 1, "REGIME_DEPENDENT": 2, "ACTIVE_LEARNING": 3}
    cards.sort(key=lambda c: (rank.get(c["category"], 9),
                              -abs(c["metric"]["expectancy_pct"]) * c["metric"]["trades"]))

    return cards[:MAX_CARDS]


def main():
    try:
        trades = fetch_trades()
        cards = build_cards(trades)
        print(json.dumps({
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total_closed_trades": len(trades),
            "cards": cards,
        }))
    except Exception as exc:
        print(json.dumps({
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total_closed_trades": 0,
            "cards": [],
            "error": f"{type(exc).__name__}: {exc}",
        }), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
