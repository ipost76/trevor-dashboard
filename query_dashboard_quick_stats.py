#!/usr/bin/env python3
"""
Quick stats strip for the Dashboard.

Schema notes (Phase 0 audit findings):
- No `signals` table -> use trade_insights.
- No `direction` column -> use trade_insights.signal_type (LONG/SHORT).
- trade_insights.confidence is 0-1 scale -> multiply by 100 for display.

JSON output:
{
  "today_signals": 13,
  "avg_confidence": 55.1,        # past 24h, displayed as 0-100
  "long_pct": 38.5,              # % LONG of past-24h
  "short_pct": 61.5,             # % SHORT of past-24h
  "data_available": true
}
"""
from __future__ import annotations

import json
import sqlite3
import sys
from typing import Any, Dict

DB = "/home/trevor/trevor/trevor.db"


def main() -> None:
    out: Dict[str, Any] = {
        "today_signals": 0,
        "avg_confidence": 0.0,
        "long_pct": 0.0,
        "short_pct": 0.0,
        "data_available": False,
    }
    try:
        with sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10) as conn:
            row = conn.execute(
                """
                SELECT COUNT(*) AS total,
                       AVG(confidence) AS avg_conf,
                       SUM(CASE WHEN signal_type='LONG'  THEN 1 ELSE 0 END) AS longs,
                       SUM(CASE WHEN signal_type='SHORT' THEN 1 ELSE 0 END) AS shorts
                FROM trade_insights
                WHERE created_at >= datetime('now','-1 day')
                """
            ).fetchone()
            total = row[0] or 0
            avg_conf_raw = row[1] or 0.0
            longs = row[2] or 0
            shorts = row[3] or 0
            long_pct = (longs / total * 100.0) if total else 0.0
            short_pct = (shorts / total * 100.0) if total else 0.0

            # confidence stored 0-1; display as 0-100
            avg_conf_display = float(avg_conf_raw) * 100.0

        out.update({
            "today_signals": int(total),
            "avg_confidence": round(avg_conf_display, 1),
            "long_pct": round(long_pct, 1),
            "short_pct": round(short_pct, 1),
            "data_available": True,
        })
        print(json.dumps(out))
    except Exception as exc:
        out["error"] = f"{type(exc).__name__}: {exc}"
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
