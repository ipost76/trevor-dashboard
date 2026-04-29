#!/usr/bin/env python3
"""
Dashboard hero PnL aggregation (C1, 2026-04-29).

Args:
  argv[1] = system: 'auto' | 'degen' | 'scalp'
  argv[2] = range:  'today' | '7d' | '30d' | 'lifetime'

JSON output:
{
  "system": "auto",
  "range": "7d",
  "total_pnl_pct": -1.42,
  "total_pnl_usd": -0.71,
  "wins": 4,
  "losses": 11,
  "win_rate": 26.7,
  "streak": -3,                 # negative = losing streak
  "trade_count": 15,
  "equity_series": [
    {"ts": "2026-04-21T...", "equity": 50.0, "pnl": 0.0},
    ...
  ],
  "data_available": true,
  "message": null
}

Source mapping (per audit Phase 6.5):
  auto  -> auto_trades.trade_mode='live'   (33 closed live rows lifetime)
  scalp -> unified_outcomes.source='live'  (74 lifetime; from trade_outcomes)
  degen -> stub, data_available=False
"""
from __future__ import annotations

import json
import sqlite3
import sys
from typing import Dict, Any, List, Tuple

DB = "/home/trevor/trevor/trevor.db"

RANGE_TO_SQL: Dict[str, str] = {
    "today":    "datetime('now','-1 day')",
    "7d":       "datetime('now','-7 days')",
    "30d":      "datetime('now','-30 days')",
    "lifetime": "datetime('1970-01-01')",
}


def empty_response(system: str, rng: str, message: str) -> Dict[str, Any]:
    return {
        "system": system,
        "range": rng,
        "total_pnl_pct": 0.0,
        "total_pnl_usd": 0.0,
        "wins": 0,
        "losses": 0,
        "win_rate": 0.0,
        "streak": 0,
        "trade_count": 0,
        "equity_series": [],
        "data_available": False,
        "message": message,
    }


def compute_streak(rows: List[Tuple]) -> int:
    """rows ordered DESC by close ts; rows[0] is most recent. PnL pct in column 0."""
    if not rows:
        return 0
    first_sign = 1 if rows[0][0] > 0 else -1 if rows[0][0] < 0 else 0
    if first_sign == 0:
        return 0
    streak = 0
    for r in rows:
        sign = 1 if r[0] > 0 else -1 if r[0] < 0 else 0
        if sign == first_sign:
            streak += first_sign
        else:
            break
    return streak


def fetch_auto(rng: str) -> Dict[str, Any]:
    since_sql = RANGE_TO_SQL.get(rng, RANGE_TO_SQL["lifetime"])
    with sqlite3.connect(DB, timeout=4.0) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            f"""
            SELECT pnl_pct, pnl_usd, closed_at
            FROM auto_trades
            WHERE trade_mode='live'
              AND status='closed'
              AND closed_at >= {since_sql}
            ORDER BY closed_at DESC
            """
        ).fetchall()

        if not rows:
            return empty_response("auto", rng, "No closed AutoTrader trades in this range.")

        total_pnl_pct = sum((r["pnl_pct"] or 0) for r in rows)
        total_pnl_usd = sum((r["pnl_usd"] or 0) for r in rows)
        wins = sum(1 for r in rows if (r["pnl_pct"] or 0) > 0)
        losses = sum(1 for r in rows if (r["pnl_pct"] or 0) < 0)
        wr = (wins / len(rows) * 100.0) if rows else 0.0
        streak = compute_streak([(r["pnl_pct"] or 0,) for r in rows])

        equity_rows = conn.execute(
            f"""
            SELECT closed_at AS ts, pnl_usd
            FROM auto_trades
            WHERE trade_mode='live'
              AND status='closed'
              AND closed_at >= {since_sql}
            ORDER BY closed_at ASC
            """
        ).fetchall()

    capital_seed = 50.0  # LIVE_CAPITAL_USD baseline
    equity = capital_seed
    series = (
        [{"ts": equity_rows[0]["ts"] if equity_rows else "", "equity": equity, "pnl": 0.0}]
        if equity_rows else []
    )
    for r in equity_rows:
        equity += (r["pnl_usd"] or 0)
        series.append({"ts": r["ts"], "equity": round(equity, 4), "pnl": round(r["pnl_usd"] or 0, 4)})

    return {
        "system": "auto",
        "range": rng,
        "total_pnl_pct": round(total_pnl_pct, 4),
        "total_pnl_usd": round(total_pnl_usd, 4),
        "wins": wins,
        "losses": losses,
        "win_rate": round(wr, 2),
        "streak": streak,
        "trade_count": len(rows),
        "equity_series": series,
        "data_available": True,
        "message": None,
    }


def fetch_scalp(rng: str) -> Dict[str, Any]:
    since_sql = RANGE_TO_SQL.get(rng, RANGE_TO_SQL["lifetime"])
    with sqlite3.connect(DB, timeout=4.0) as conn:
        conn.row_factory = sqlite3.Row
        # Scalp = manual trades; per audit Phase 6.5 these surface via
        # unified_outcomes.source='live' joined to trade_outcomes.
        rows = conn.execute(
            f"""
            SELECT pnl_pct, outcome_timestamp AS closed_at
            FROM unified_outcomes
            WHERE source='live'
              AND outcome_timestamp >= {since_sql}
            ORDER BY outcome_timestamp DESC
            """
        ).fetchall()

        if not rows:
            return empty_response("scalp", rng, "No closed scalp trades in this range.")

        total_pnl_pct = sum((r["pnl_pct"] or 0) for r in rows)
        wins = sum(1 for r in rows if (r["pnl_pct"] or 0) > 0)
        losses = sum(1 for r in rows if (r["pnl_pct"] or 0) < 0)
        wr = (wins / len(rows) * 100.0) if rows else 0.0
        streak = compute_streak([(r["pnl_pct"] or 0,) for r in rows])

        equity_rows = conn.execute(
            f"""
            SELECT outcome_timestamp AS ts, pnl_pct
            FROM unified_outcomes
            WHERE source='live'
              AND outcome_timestamp >= {since_sql}
            ORDER BY outcome_timestamp ASC
            """
        ).fetchall()

    cumulative = 0.0
    series: List[Dict[str, Any]] = []
    if equity_rows:
        series.append({"ts": equity_rows[0]["ts"], "equity": 0.0, "pnl": 0.0})
    for r in equity_rows:
        cumulative += (r["pnl_pct"] or 0)
        series.append({"ts": r["ts"], "equity": round(cumulative, 4), "pnl": round(r["pnl_pct"] or 0, 4)})

    return {
        "system": "scalp",
        "range": rng,
        "total_pnl_pct": round(total_pnl_pct, 4),
        "total_pnl_usd": 0.0,
        "wins": wins,
        "losses": losses,
        "win_rate": round(wr, 2),
        "streak": streak,
        "trade_count": len(rows),
        "equity_series": series,
        "data_available": True,
        "message": None,
    }


def fetch_degen(rng: str) -> Dict[str, Any]:
    return empty_response("degen", rng, "DEGEN bot not deployed yet.")


def main() -> None:
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: query_dashboard_pnl.py <auto|degen|scalp> <today|7d|30d|lifetime>"}), file=sys.stderr)
        sys.exit(2)

    system = sys.argv[1].lower()
    rng = sys.argv[2].lower()
    if rng not in RANGE_TO_SQL:
        print(json.dumps({"error": f"invalid range '{rng}'"}), file=sys.stderr)
        sys.exit(2)

    try:
        if system == "auto":
            out = fetch_auto(rng)
        elif system == "scalp":
            out = fetch_scalp(rng)
        elif system == "degen":
            out = fetch_degen(rng)
        else:
            print(json.dumps({"error": f"invalid system '{system}'"}), file=sys.stderr)
            sys.exit(2)
        print(json.dumps(out))
    except Exception as exc:
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
