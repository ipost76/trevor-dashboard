#!/usr/bin/env python3
"""
Cross-system active position aggregation for the C1 Dashboard hero (2026-04-29).

JSON output:
{
  "count": 2,
  "positions": [
    {
      "id": "auto:1234",
      "system": "auto" | "scalp",
      "ticker": "BTC",
      "direction": "LONG" | "SHORT",
      "entry_price": 76723.5,
      "current_price": null,    # filled by client via /api/prices zip
      "pnl_pct": null,          # client-computed once price + leverage known
      "pnl_usd": null,
      "leverage": 5.0,
      "hold_minutes": 17,
      "opened_at": "2026-04-28T...",
      "exit_strategy_hint": "momentum_exit_30"
    },
    ...
  ]
}

Source mapping:
  auto  -> auto_trades WHERE status='open' AND trade_mode='live'
  scalp -> active_trades WHERE status='open'

DEGEN intentionally absent (system not yet deployed).
"""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Dict, Any, List

DB = "/home/trevor/trevor/trevor.db"


def parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        if ts.endswith("Z"):
            ts = ts[:-1] + "+00:00"
        return datetime.fromisoformat(ts)
    except Exception:
        # SQLite default datetime('now') format: 'YYYY-MM-DD HH:MM:SS' (UTC, naive)
        try:
            return datetime.strptime(ts, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        except Exception:
            return None


def hold_minutes(opened_at: str | None) -> int:
    dt = parse_iso(opened_at) if opened_at else None
    if not dt:
        return 0
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    delta = (now - dt).total_seconds() / 60.0
    return max(0, int(delta))


def fetch_auto_open() -> List[Dict[str, Any]]:
    with sqlite3.connect(DB, timeout=4.0) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT id, ticker, direction, entry_price, leverage,
                   notional_usd, opened_at, exit_signals_log,
                   peak_pnl_pct, trade_mode
            FROM auto_trades
            WHERE status='open' AND trade_mode='live'
            ORDER BY opened_at DESC
            """
        ).fetchall()
    return [
        {
            "id": f"auto:{r['id']}",
            "system": "auto",
            "ticker": r["ticker"],
            "direction": r["direction"],
            "entry_price": float(r["entry_price"] or 0),
            "current_price": None,
            "pnl_pct": None,
            "pnl_usd": None,
            "leverage": float(r["leverage"] or 1),
            "hold_minutes": hold_minutes(r["opened_at"]),
            "opened_at": r["opened_at"],
            "exit_strategy_hint": (r["exit_signals_log"] or "")[:32] if r["exit_signals_log"] else None,
        }
        for r in rows
    ]


def fetch_scalp_open() -> List[Dict[str, Any]]:
    with sqlite3.connect(DB, timeout=4.0) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT id, ticker, direction, entry_price, opened_at, leverage
            FROM active_trades
            WHERE status='open'
            ORDER BY opened_at DESC
            """
        ).fetchall()
    return [
        {
            "id": f"scalp:{r['id']}",
            "system": "scalp",
            "ticker": r["ticker"],
            "direction": r["direction"],
            "entry_price": float(r["entry_price"] or 0),
            "current_price": None,
            "pnl_pct": None,
            "pnl_usd": None,
            "leverage": float(r["leverage"] or 1),
            "hold_minutes": hold_minutes(r["opened_at"]),
            "opened_at": r["opened_at"],
            "exit_strategy_hint": None,
        }
        for r in rows
    ]


def main() -> None:
    try:
        positions = fetch_auto_open() + fetch_scalp_open()
        positions.sort(key=lambda p: p.get("opened_at") or "", reverse=True)
        print(json.dumps({"count": len(positions), "positions": positions}))
    except Exception as exc:
        print(json.dumps({"count": 0, "positions": [], "error": f"{type(exc).__name__}: {exc}"}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
