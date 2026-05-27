#!/usr/bin/env python3
"""
Consolidated AUTO trades view for /api/auto/trades (D3, 2026-04-30).

Args:
  argv[1] = type:  'open' | 'closed' (default 'closed')
  argv[2] = limit: int 1..200 (default 10)

JSON output for type='open':
  {
    "type": "open",
    "count": <N>,
    "positions": [
      { id, ticker, direction, entry_price, stop_price, target_price,
        leverage, confidence, notional_usd, opened_at, exit_signals_log,
        peak_pnl_pct, trade_mode }
    ]
  }

JSON output for type='closed':
  {
    "type": "closed",
    "count": <N>,
    "trades": [
      { id, ticker, direction, pnl_pct, pnl_usd, hold_duration_minutes,
        closed_at, exit_reason, trade_mode }
    ]
  }

Notes:
- READ-ONLY (`file:...?mode=ro`).
- Both queries filter by `trade_mode='live'` per D3 spec — paper trades
  are not surfaced through the new AUTO endpoints.
- `confidence` and stop/target prices are preserved on open positions so
  D1's ActivePositionCard fmtPrice + future PositionCards keep their data.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

DB = "/home/trevor/trevor/trevor.db"


def _connect_ro() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10)


def _rows_to_dicts(cursor) -> list[dict]:
    cols = [c[0] for c in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def fetch_open(limit: int) -> dict:
    with _connect_ro() as conn:
        cur = conn.execute(
            f"""
            SELECT id, ticker, direction, entry_price, stop_price, target_price,
                   leverage, confidence, notional_usd, opened_at,
                   exit_signals_log, peak_pnl_pct, trade_mode
            FROM auto_trades
            WHERE status='open' AND trade_mode='live'
            ORDER BY opened_at DESC
            LIMIT {limit}
            """
        )
        rows = _rows_to_dicts(cur)
    return {"type": "open", "count": len(rows), "positions": rows}


def fetch_closed(limit: int) -> dict:
    with _connect_ro() as conn:
        cur = conn.execute(
            f"""
            SELECT id, ticker, direction, pnl_pct, pnl_usd,
                   hold_duration_minutes, closed_at, exit_reason, trade_mode
            FROM auto_trades
            WHERE status='closed' AND trade_mode='live'
            ORDER BY closed_at DESC
            LIMIT {limit}
            """
        )
        rows = _rows_to_dicts(cur)
    return {"type": "closed", "count": len(rows), "trades": rows}


def main() -> int:
    typ = (sys.argv[1] if len(sys.argv) >= 2 else "closed").lower()
    try:
        limit = int(sys.argv[2]) if len(sys.argv) >= 3 else 10
    except ValueError:
        limit = 10
    limit = max(1, min(200, limit))

    if typ not in ("open", "closed"):
        sys.stdout.write(json.dumps({
            "type": typ, "count": 0,
            "error": f"invalid type: {typ}",
        }))
        return 1

    if not Path(DB).exists():
        sys.stdout.write(json.dumps({
            "type": typ, "count": 0,
            "positions" if typ == "open" else "trades": [],
            "error": f"DB not found: {DB}",
        }))
        return 1

    try:
        out = fetch_open(limit) if typ == "open" else fetch_closed(limit)
        sys.stdout.write(json.dumps(out, default=str))
        return 0
    except Exception as exc:
        sys.stdout.write(json.dumps({
            "type": typ, "count": 0,
            "positions" if typ == "open" else "trades": [],
            "error": f"{type(exc).__name__}: {exc}",
        }))
        return 1


if __name__ == "__main__":
    # OUTER-WRAP: 2026-05-27 (silent-crash visibility)
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        sys.exit(main())

    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
