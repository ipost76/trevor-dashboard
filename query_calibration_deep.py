#!/usr/bin/env python3
"""Calibration deep-dive — buckets globally + sliced by regime + by ticker.

Reads from `unified_outcomes` VIEW. Columns are `confidence` and `regime`
(no `_at_entry` suffix on this view). 0-100 scale.

Buckets mirror F1 / dashboard convention: 35-44 / 45-54 / 55-64 / 65-74 / 75+.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from collections import defaultdict
from typing import Any, Dict, List

DB = "/home/trevor/trevor/trevor.db"

BUCKETS = [
    (35, 44, "35-44"),
    (45, 54, "45-54"),
    (55, 64, "55-64"),
    (65, 74, "65-74"),
    (75, 999, "75+"),
]


def conf_to_bucket(c: float) -> str:
    for lo, hi, name in BUCKETS:
        if lo <= c <= hi:
            return name
    return "—"


def aggregate(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_bucket: Dict[str, List[float]] = defaultdict(list)
    for r in rows:
        c = r.get("confidence")
        if c is None:
            continue
        by_bucket[conf_to_bucket(float(c))].append(float(r["pnl_pct"]))
    out: List[Dict[str, Any]] = []
    for _, _, name in BUCKETS:
        pnls = by_bucket.get(name, [])
        if not pnls:
            out.append({"bucket": name, "trades": 0, "win_rate": 0.0, "avg_pnl_pct": 0.0, "expectancy": 0.0})
            continue
        wins = sum(1 for p in pnls if p > 0)
        wr = (wins / len(pnls)) * 100.0
        avg = sum(pnls) / len(pnls)
        out.append({
            "bucket": name,
            "trades": len(pnls),
            "win_rate": round(wr, 2),
            "avg_pnl_pct": round(avg, 4),
            "expectancy": round(avg, 4),
        })
    return out


def main():
    try:
        with sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=4.0) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT pnl_pct,
                       confidence,
                       regime,
                       ticker
                FROM unified_outcomes
                WHERE pnl_pct IS NOT NULL
                  AND confidence IS NOT NULL
                """
            ).fetchall()
        rows = [dict(r) for r in rows]

        global_buckets = aggregate(rows)

        by_regime: Dict[str, List[Dict[str, Any]]] = {}
        regimes = sorted({(r.get("regime") or "—") for r in rows})
        for reg in regimes:
            subset = [r for r in rows if (r.get("regime") or "—") == reg]
            by_regime[reg] = aggregate(subset)

        by_ticker: Dict[str, List[Dict[str, Any]]] = {}
        tickers = sorted({(r.get("ticker") or "—") for r in rows})
        for tk in tickers:
            subset = [r for r in rows if (r.get("ticker") or "—") == tk]
            by_ticker[tk] = aggregate(subset)

        print(json.dumps({
            "global_buckets": global_buckets,
            "by_regime": by_regime,
            "by_ticker": by_ticker,
            "data_available": len(rows) > 0,
            "total_rows": len(rows),
        }))
    except Exception as exc:
        print(json.dumps({"error": str(exc), "data_available": False}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
