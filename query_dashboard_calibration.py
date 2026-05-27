#!/usr/bin/env python3
"""
Calibration buckets read for Dashboard tile (Option B).

Schema note: no calibration_cache table exists; calibration is computed
dynamically from the unified_outcomes VIEW. Buckets follow the same
contract as query_quality.py cmd_by_confidence: 30-40, 40-50, 50-60,
60-70, 70-80, 80+ (six buckets, confidence is 0-1 scale on
unified_outcomes; bucket label is a percentage string).

Output win_rate is a percentage 0-100 for display convenience (multiplied
in script so the React component can render directly without conversion).

Sweet spot = highest WR with n>=5; dead zone = lowest WR with n>=5.

JSON output:
{
  "buckets": [{"bucket":"30-40","trades":36,"win_rate":41.7,"avg_pnl":-0.27},...],
  "sweet_spot": {"bucket":"70-80","trades":74,"win_rate":50.0,"avg_pnl":-0.04},
  "dead_zone":  {"bucket":"80+","trades":8,"win_rate":37.5,"avg_pnl":-0.96},
  "data_available": true,
  "message": null
}
"""
from __future__ import annotations

import json
import sqlite3
import sys
from typing import Any, Dict, List, Optional

DB = "/home/trevor/trevor/trevor.db"

# Bucket edges in 0-100 scale (matches unified_outcomes.confidence range,
# verified Phase 0: paper.confidence + backfill.final_confidence are stored
# 0-100; live source has NULL). This mirrors query_quality.py cmd_by_confidence.
BUCKETS = [
    (30, 40, "30-40"),
    (40, 50, "40-50"),
    (50, 60, "50-60"),
    (60, 70, "60-70"),
    (70, 80, "70-80"),
    (80, 999, "80+"),
]


def main() -> None:
    out: Dict[str, Any] = {
        "buckets": [],
        "sweet_spot": None,
        "dead_zone": None,
        "data_available": False,
        "message": None,
    }
    try:
        with sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10) as conn:
            buckets: List[Dict[str, Any]] = []
            for lo, hi, label in BUCKETS:
                row = conn.execute(
                    """
                    SELECT COUNT(*)            AS n,
                           SUM(was_win)        AS wins,
                           AVG(pnl_pct)        AS avg_pnl
                    FROM unified_outcomes
                    WHERE confidence IS NOT NULL
                      AND aggressive_mode = 0
                      AND confidence >= ? AND confidence < ?
                    """,
                    (lo, hi),
                ).fetchone()
                n = row[0] or 0
                wins = row[1] or 0
                avg_pnl = row[2] or 0.0
                wr_pct = (wins / n * 100.0) if n else 0.0
                buckets.append({
                    "bucket": label,
                    "trades": int(n),
                    "win_rate": round(wr_pct, 1),
                    "avg_pnl": round(float(avg_pnl), 3),
                })

        eligible = [b for b in buckets if b["trades"] >= 5]
        sweet: Optional[Dict[str, Any]] = None
        dead: Optional[Dict[str, Any]] = None
        if eligible:
            sweet = max(eligible, key=lambda b: b["win_rate"])
            dead = min(eligible, key=lambda b: b["win_rate"])

        any_data = any(b["trades"] > 0 for b in buckets)

        out.update({
            "buckets": buckets,
            "sweet_spot": sweet,
            "dead_zone": dead,
            "data_available": bool(any_data),
            "message": None if any_data else "No calibration data yet.",
        })
        print(json.dumps(out))
    except Exception as exc:
        out["error"] = f"{type(exc).__name__}: {exc}"
        out["message"] = f"{type(exc).__name__}: {exc}"
        print(json.dumps(out), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    # OUTER-WRAP: 2026-05-27 (silent-crash visibility)
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        main()

    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
