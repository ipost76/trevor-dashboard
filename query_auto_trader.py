#!/usr/bin/env python3
"""
Hub helper for /api/auto-trader — READ-ONLY snapshot of the mirrored auto
trader (auto_trades + auto_config tables).

Usage:
    python3 query_auto_trader.py         # default full snapshot (JSON to stdout)

Response shape (matches /api/auto-trader contract — Prompt 5/6):
    {
      enabled: bool,
      equity: float,
      open_positions: [ { id, ticker, direction, entry_price, stop_price,
                          target_price, leverage, confidence, notional_usd,
                          opened_at, unrealized_pnl_pct } ],
      recent_trades: [ { id, ticker, direction, entry_price, exit_price,
                         pnl_usd, pnl_pct, exit_reason, hold_duration_minutes,
                         closed_at } ],
      stats_7d: { total_trades, wins, losses, win_rate, total_pnl },
      config: { KEY: VALUE, ... },
    }

READ-ONLY: uses SQLite URI `file:...?mode=ro` so the Hub process cannot
mutate the DB. Writes (enable/disable) go through the Discord !auto
command path, not through the Hub API.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path

DB_PATH = os.environ.get(
    "TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db"
)

STARTING_CAPITAL_FALLBACK = 50.0  # matches auto_trader default


def _connect_ro() -> sqlite3.Connection:
    """Open trevor.db in read-only URI mode."""
    return sqlite3.connect(
        f"file:{DB_PATH}?mode=ro", uri=True, timeout=5.0
    )


def _rows_to_dicts(cursor) -> list[dict]:
    cols = [c[0] for c in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def _fetch_config(conn: sqlite3.Connection) -> dict:
    try:
        rows = conn.execute(
            "SELECT key, value FROM auto_config"
        ).fetchall()
        return {k: v for k, v in rows}
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
        cur = conn.execute(
            "SELECT id, ticker, direction, entry_price, stop_price, "
            "target_price, leverage, confidence, notional_usd, opened_at, "
            "peak_pnl_pct, exit_signals_log, trade_mode "
            "FROM auto_trades WHERE status = 'open' "
            "ORDER BY opened_at DESC"
        )
        rows = _rows_to_dicts(cur)
    except sqlite3.OperationalError:
        return []

    # unrealized_pnl_pct: recompute if we had a live price oracle here;
    # for now leave null so the Hub frontend can fetch via /api/prices
    # and overlay client-side (matches live-board pattern).
    for r in rows:
        r["unrealized_pnl_pct"] = None
    return rows


def _recent_trades(conn: sqlite3.Connection, limit: int = 10) -> list[dict]:
    try:
        cur = conn.execute(
            "SELECT id, ticker, direction, entry_price, exit_price, "
            "pnl_usd, pnl_pct, exit_reason, hold_duration_minutes, closed_at "
            "FROM auto_trades WHERE status = 'closed' "
            "ORDER BY closed_at DESC LIMIT ?",
            (int(limit),),
        )
        return _rows_to_dicts(cur)
    except sqlite3.OperationalError:
        return []


def _stats_7d(conn: sqlite3.Connection) -> dict:
    try:
        cur = conn.execute(
            "SELECT pnl_usd FROM auto_trades WHERE status = 'closed' "
            "AND closed_at >= datetime('now', '-7 days')"
        )
        pnls = [float(r[0] or 0) for r in cur.fetchall()]
    except sqlite3.OperationalError:
        return {
            "total_trades": 0, "wins": 0, "losses": 0,
            "win_rate": 0.0, "total_pnl": 0.0,
        }

    if not pnls:
        return {
            "total_trades": 0, "wins": 0, "losses": 0,
            "win_rate": 0.0, "total_pnl": 0.0,
        }
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]
    return {
        "total_trades": len(pnls),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(len(wins) / len(pnls) * 100.0, 1),
        "total_pnl": round(sum(pnls), 4),
    }


def snapshot() -> dict:
    if not Path(DB_PATH).exists():
        return {
            "enabled": False, "equity": 0.0, "open_positions": [],
            "recent_trades": [], "stats_7d": {
                "total_trades": 0, "wins": 0, "losses": 0,
                "win_rate": 0.0, "total_pnl": 0.0,
            },
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
            "open_positions": _open_positions(conn),
            "recent_trades": _recent_trades(conn),
            "stats_7d": _stats_7d(conn),
            "config": config,
        }
    finally:
        conn.close()


def main() -> int:
    try:
        data = snapshot()
        sys.stdout.write(json.dumps(data, default=str))
        return 0
    except Exception as e:
        sys.stdout.write(json.dumps({
            "enabled": False, "equity": 0.0, "open_positions": [],
            "recent_trades": [],
            "stats_7d": {"total_trades": 0, "wins": 0, "losses": 0,
                         "win_rate": 0.0, "total_pnl": 0.0},
            "config": {},
            "error": str(e),
        }))
        return 1


if __name__ == "__main__":
    sys.exit(main())
