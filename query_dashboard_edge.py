#!/usr/bin/env python3
"""
Edge analysis aggregation for the Dashboard supporting widgets.

Reads from the unified_outcomes VIEW (paper + backfill + live union),
last 90 days. Sample floor = 5 trades.

JSON output:
{
  "expectancy_pct": 0.42,
  "win_loss_ratio": 1.30,
  "avg_win_pct": 1.85,
  "avg_loss_pct": -1.42,
  "best_pct": 6.20,
  "worst_pct": -4.10,
  "asymmetric": true,
  "sample_n": 941,
  "data_available": true,
  "message": null
}
"""
from __future__ import annotations

import json
import sqlite3
import sys
from typing import Any, Dict, List

DB = "/home/trevor/trevor/trevor.db"


def empty(message: str) -> Dict[str, Any]:
    return {
        "expectancy_pct": 0.0,
        "win_loss_ratio": 0.0,
        "avg_win_pct": 0.0,
        "avg_loss_pct": 0.0,
        "best_pct": 0.0,
        "worst_pct": 0.0,
        "asymmetric": False,
        "sample_n": 0,
        "data_available": False,
        "message": message,
    }


def main() -> None:
    try:
        with sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10) as conn:
            rows = conn.execute(
                """
                SELECT pnl_pct
                FROM unified_outcomes
                WHERE pnl_pct IS NOT NULL
                  AND outcome_timestamp >= datetime('now','-90 days')
                """
            ).fetchall()

        pnls: List[float] = [float(r[0]) for r in rows if r[0] is not None]
        if len(pnls) < 5:
            print(json.dumps(empty(f"Need >=5 trades for edge analysis (have {len(pnls)}).")))
            return

        wins = [p for p in pnls if p > 0]
        losses = [p for p in pnls if p < 0]
        avg_win = (sum(wins) / len(wins)) if wins else 0.0
        avg_loss = (sum(losses) / len(losses)) if losses else 0.0
        win_rate = (len(wins) / len(pnls)) if pnls else 0.0

        win_loss_ratio = (avg_win / abs(avg_loss)) if avg_loss != 0 else 0.0
        expectancy = (win_rate * avg_win) + ((1 - win_rate) * avg_loss)
        asymmetric = (win_rate * avg_win) >= ((1 - win_rate) * abs(avg_loss))

        print(json.dumps({
            "expectancy_pct": round(expectancy, 4),
            "win_loss_ratio": round(win_loss_ratio, 3),
            "avg_win_pct": round(avg_win, 3),
            "avg_loss_pct": round(avg_loss, 3),
            "best_pct": round(max(pnls), 3),
            "worst_pct": round(min(pnls), 3),
            "asymmetric": bool(asymmetric),
            "sample_n": len(pnls),
            "data_available": True,
            "message": None,
        }))
    except Exception as exc:
        print(json.dumps(empty(f"{type(exc).__name__}: {exc}")), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
