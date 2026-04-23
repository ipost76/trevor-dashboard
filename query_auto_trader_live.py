#!/usr/bin/env python3
"""
Hub helper for /api/auto-trader/stream (P1 overhaul, 2026-04-23).

Extended READ-ONLY snapshot of auto_trades + auto_config including the full
exit engine column set. Caller (Node SSE route) overlays Hyperliquid prices
and computes live P&L/R-multiple/hold display so this helper stays pure-SQL
and fast.

Usage:
    python3 query_auto_trader_live.py            # full snapshot

Response shape:
    {
      "enabled": bool,
      "equity": float,
      "starting_capital": float,
      "open_positions": [ { id, ticker, direction, entry_price, stop_price,
                            target_price, leverage, notional_usd,
                            original_notional_usd, confidence,
                            adjusted_confidence, peak_pnl_pct, peak_price,
                            trough_price, partial_exits_taken,
                            partial_pnl_realized, breakeven_stop_active,
                            opened_at, regime_at_entry, market_state } ],
      "stats_7d": { total_trades, wins, losses, win_rate, total_pnl },
      "trades_today": int,
      "config": { KEY: VALUE, ... }
    }

READ-ONLY: opens SQLite via `file:...?mode=ro`. Writes go through the
separate `query_auto_trader_config.py` helper (whitelisted keys only).
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path

DB_PATH = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")
STARTING_CAPITAL_FALLBACK = 50.0

# Columns selected for open positions — mirrors executor's live view
OPEN_COLS = [
    "id", "ticker", "direction", "entry_price", "stop_price", "target_price",
    "leverage", "notional_usd", "original_notional_usd", "confidence",
    "adjusted_confidence", "peak_pnl_pct", "peak_price", "trough_price",
    "partial_exits_taken", "partial_pnl_realized", "breakeven_stop_active",
    "opened_at", "regime_at_entry", "market_state",
]


def _connect_ro() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=5.0)


def _fetch_config(conn: sqlite3.Connection) -> dict:
    try:
        return {k: v for k, v in conn.execute(
            "SELECT key, value FROM auto_config"
        ).fetchall()}
    except sqlite3.OperationalError:
        return {}


def _starting_capital(config: dict) -> float:
    try:
        return float(config.get("CAPITAL_USD") or STARTING_CAPITAL_FALLBACK)
    except (TypeError, ValueError):
        return STARTING_CAPITAL_FALLBACK


def _equity(conn: sqlite3.Connection, starting: float) -> float:
    try:
        realized = conn.execute(
            "SELECT COALESCE(SUM(pnl_usd), 0) FROM auto_trades "
            "WHERE status = 'closed'"
        ).fetchone()[0]
        return round(float(starting) + float(realized or 0.0), 4)
    except sqlite3.OperationalError:
        return round(float(starting), 4)


def _open_positions(conn: sqlite3.Connection) -> list[dict]:
    try:
        cols = ", ".join(OPEN_COLS)
        cur = conn.execute(
            f"SELECT {cols} FROM auto_trades WHERE status = 'open' "
            "ORDER BY opened_at DESC"
        )
        rows = cur.fetchall()
    except sqlite3.OperationalError:
        return []
    out = []
    for row in rows:
        out.append({OPEN_COLS[i]: row[i] for i in range(len(OPEN_COLS))})
    # Coerce breakeven_stop_active to bool (DB stores 0/1 INT)
    for r in out:
        r["breakeven_stop_active"] = bool(r.get("breakeven_stop_active") or 0)
    return out


def _stats_7d(conn: sqlite3.Connection) -> dict:
    empty = {"total_trades": 0, "wins": 0, "losses": 0,
             "win_rate": 0.0, "total_pnl": 0.0}
    try:
        pnls = [float(r[0] or 0) for r in conn.execute(
            "SELECT pnl_usd FROM auto_trades WHERE status = 'closed' "
            "AND closed_at >= datetime('now', '-7 days')"
        ).fetchall()]
    except sqlite3.OperationalError:
        return empty
    if not pnls:
        return empty
    wins = [p for p in pnls if p > 0]
    return {
        "total_trades": len(pnls),
        "wins": len(wins),
        "losses": len(pnls) - len(wins),
        "win_rate": round(len(wins) / len(pnls) * 100.0, 1),
        "total_pnl": round(sum(pnls), 4),
    }


def _trades_today(conn: sqlite3.Connection) -> int:
    try:
        row = conn.execute(
            "SELECT COUNT(*) FROM auto_trades WHERE opened_at >= date('now')"
        ).fetchone()
        return int(row[0] or 0)
    except sqlite3.OperationalError:
        return 0


def snapshot() -> dict:
    if not Path(DB_PATH).exists():
        return {
            "enabled": False, "equity": 0.0, "starting_capital": STARTING_CAPITAL_FALLBACK,
            "open_positions": [],
            "stats_7d": {"total_trades": 0, "wins": 0, "losses": 0,
                         "win_rate": 0.0, "total_pnl": 0.0},
            "trades_today": 0,
            "config": {},
            "error": f"DB not found: {DB_PATH}",
        }
    conn = _connect_ro()
    try:
        config = _fetch_config(conn)
        starting = _starting_capital(config)
        enabled_val = (config.get("AUTO_TRADER_ENABLED") or "false").lower()
        return {
            "enabled": enabled_val == "true",
            "equity": _equity(conn, starting),
            "starting_capital": starting,
            "open_positions": _open_positions(conn),
            "stats_7d": _stats_7d(conn),
            "trades_today": _trades_today(conn),
            "config": config,
        }
    finally:
        conn.close()


def main() -> int:
    try:
        sys.stdout.write(json.dumps(snapshot(), default=str))
        return 0
    except Exception as e:
        sys.stdout.write(json.dumps({
            "enabled": False, "equity": 0.0,
            "starting_capital": STARTING_CAPITAL_FALLBACK,
            "open_positions": [],
            "stats_7d": {"total_trades": 0, "wins": 0, "losses": 0,
                         "win_rate": 0.0, "total_pnl": 0.0},
            "trades_today": 0,
            "config": {},
            "error": str(e),
        }))
        return 1


if __name__ == "__main__":
    sys.exit(main())
