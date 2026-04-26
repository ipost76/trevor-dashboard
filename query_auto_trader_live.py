#!/usr/bin/env python3
"""
Hub helper for /api/auto-trader/stream (P1 overhaul, 2026-04-23).

Extended READ-ONLY snapshot of auto_trades + auto_config including the full
exit engine column set. Caller (Node SSE route) overlays Hyperliquid prices
and computes live P&L/R-multiple/hold display so this helper stays pure-SQL
and fast.

2026-04-26 — Premium hero pass: mode-aware aggregates (today_pnl,
open_notional, last_trade_at, consecutive_losses, equity by trade_mode)
and surfaces AUTO_LIVE_ENABLED as `mode` ("live" | "paper").

Usage:
    python3 query_auto_trader_live.py            # full snapshot

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
    "opened_at", "regime_at_entry", "market_state", "trade_mode",
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


def _starting_capital(config: dict, mode: str) -> float:
    """Live mode uses LIVE_CAPITAL_USD; paper uses CAPITAL_USD."""
    key = "LIVE_CAPITAL_USD" if mode == "live" else "CAPITAL_USD"
    try:
        return float(config.get(key) or STARTING_CAPITAL_FALLBACK)
    except (TypeError, ValueError):
        return STARTING_CAPITAL_FALLBACK


def _equity(conn: sqlite3.Connection, starting: float, mode: str) -> float:
    """Realized P&L in current mode added to starting capital."""
    try:
        realized = conn.execute(
            "SELECT COALESCE(SUM(pnl_usd), 0) FROM auto_trades "
            "WHERE status = 'closed' AND trade_mode = ?",
            (mode,),
        ).fetchone()[0]
        return round(float(starting) + float(realized or 0.0), 4)
    except sqlite3.OperationalError:
        return round(float(starting), 4)


def _open_positions(conn: sqlite3.Connection, mode: str) -> list[dict]:
    """Open positions filtered by current mode."""
    try:
        cols = ", ".join(OPEN_COLS)
        cur = conn.execute(
            f"SELECT {cols} FROM auto_trades WHERE status = 'open' "
            "AND trade_mode = ? ORDER BY opened_at DESC",
            (mode,),
        )
        rows = cur.fetchall()
    except sqlite3.OperationalError:
        return []
    out = [{OPEN_COLS[i]: row[i] for i in range(len(OPEN_COLS))} for row in rows]
    for r in out:
        r["breakeven_stop_active"] = bool(r.get("breakeven_stop_active") or 0)
    return out


def _stats_7d(conn: sqlite3.Connection, mode: str) -> dict:
    empty = {"total_trades": 0, "wins": 0, "losses": 0,
             "win_rate": 0.0, "total_pnl": 0.0}
    try:
        pnls = [float(r[0] or 0) for r in conn.execute(
            "SELECT pnl_usd FROM auto_trades WHERE status = 'closed' "
            "AND trade_mode = ? AND closed_at >= datetime('now', '-7 days')",
            (mode,),
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


def _trades_today(conn: sqlite3.Connection, mode: str) -> int:
    try:
        row = conn.execute(
            "SELECT COUNT(*) FROM auto_trades WHERE opened_at >= date('now') "
            "AND trade_mode = ?",
            (mode,),
        ).fetchone()
        return int(row[0] or 0)
    except sqlite3.OperationalError:
        return 0


def _today_pnl(conn: sqlite3.Connection, mode: str) -> tuple[float, int]:
    """Realized P&L from trades CLOSED today + today closed count."""
    try:
        row = conn.execute(
            "SELECT COALESCE(SUM(pnl_usd), 0), COUNT(*) "
            "FROM auto_trades WHERE status = 'closed' AND trade_mode = ? "
            "AND closed_at >= date('now')",
            (mode,),
        ).fetchone()
        return round(float(row[0] or 0.0), 4), int(row[1] or 0)
    except sqlite3.OperationalError:
        return 0.0, 0


def _open_notional(conn: sqlite3.Connection, mode: str) -> float:
    try:
        row = conn.execute(
            "SELECT COALESCE(SUM(notional_usd), 0) FROM auto_trades "
            "WHERE status = 'open' AND trade_mode = ?",
            (mode,),
        ).fetchone()
        return round(float(row[0] or 0.0), 4)
    except sqlite3.OperationalError:
        return 0.0


def _last_trade_at(conn: sqlite3.Connection, mode: str) -> str | None:
    try:
        row = conn.execute(
            "SELECT MAX(closed_at) FROM auto_trades "
            "WHERE status = 'closed' AND trade_mode = ?",
            (mode,),
        ).fetchone()
        return row[0] if row and row[0] else None
    except sqlite3.OperationalError:
        return None


def _consecutive_losses(conn: sqlite3.Connection, mode: str) -> int:
    """Count of trailing losses (newest first), breaks on first non-loss."""
    try:
        rows = conn.execute(
            "SELECT pnl_usd FROM auto_trades WHERE status = 'closed' "
            "AND trade_mode = ? ORDER BY closed_at DESC LIMIT 50",
            (mode,),
        ).fetchall()
    except sqlite3.OperationalError:
        return 0
    streak = 0
    for r in rows:
        v = float(r[0] or 0.0)
        if v < 0:
            streak += 1
        else:
            break
    return streak


def _resolve_mode(config: dict) -> str:
    val = (config.get("AUTO_LIVE_ENABLED") or "false").strip().lower()
    return "live" if val == "true" else "paper"


def snapshot() -> dict:
    if not Path(DB_PATH).exists():
        return {
            "enabled": False, "mode": "paper", "equity": 0.0,
            "starting_capital": STARTING_CAPITAL_FALLBACK,
            "open_positions": [],
            "stats_7d": {"total_trades": 0, "wins": 0, "losses": 0,
                         "win_rate": 0.0, "total_pnl": 0.0},
            "trades_today": 0, "today_pnl": 0.0, "today_count": 0,
            "open_notional": 0.0, "last_trade_at": None,
            "consecutive_losses": 0, "sdk_errors": 0,
            "live_hard_cap": STARTING_CAPITAL_FALLBACK,
            "config": {},
            "error": f"DB not found: {DB_PATH}",
        }
    conn = _connect_ro()
    try:
        config = _fetch_config(conn)
        mode = _resolve_mode(config)
        starting = _starting_capital(config, mode)
        today_pnl, today_count = _today_pnl(conn, mode)
        live_hard_cap = STARTING_CAPITAL_FALLBACK
        try:
            live_hard_cap = float(
                config.get("LIVE_HARD_CAPITAL_CAP_USD") or STARTING_CAPITAL_FALLBACK
            )
        except (TypeError, ValueError):
            pass
        return {
            "enabled": (config.get("AUTO_TRADER_ENABLED") or "false").lower() == "true",
            "mode": mode,
            "equity": _equity(conn, starting, mode),
            "starting_capital": starting,
            "open_positions": _open_positions(conn, mode),
            "stats_7d": _stats_7d(conn, mode),
            "trades_today": _trades_today(conn, mode),
            "today_pnl": today_pnl,
            "today_count": today_count,
            "open_notional": _open_notional(conn, mode),
            "last_trade_at": _last_trade_at(conn, mode),
            "consecutive_losses": _consecutive_losses(conn, mode),
            # SDK error counter is in-memory in live_executor; not persisted.
            # Surface 0 from the Hub until/unless that telemetry lands in DB.
            "sdk_errors": 0,
            "live_hard_cap": round(live_hard_cap, 4),
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
            "enabled": False, "mode": "paper", "equity": 0.0,
            "starting_capital": STARTING_CAPITAL_FALLBACK,
            "open_positions": [],
            "stats_7d": {"total_trades": 0, "wins": 0, "losses": 0,
                         "win_rate": 0.0, "total_pnl": 0.0},
            "trades_today": 0, "today_pnl": 0.0, "today_count": 0,
            "open_notional": 0.0, "last_trade_at": None,
            "consecutive_losses": 0, "sdk_errors": 0,
            "live_hard_cap": STARTING_CAPITAL_FALLBACK,
            "config": {},
            "error": str(e),
        }))
        return 1


if __name__ == "__main__":
    sys.exit(main())
