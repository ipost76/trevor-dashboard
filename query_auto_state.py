#!/usr/bin/env python3
"""
Consolidated AUTO state for /api/auto/state (D3, 2026-04-30).

Aggregates: capital, live capital, equity, today's P&L (live only),
trade count today, open positions count, AUTO_TRADER_ENABLED,
AUTO_LIVE_ENABLED, EMERGENCY_KILLSWITCH, per-ticker thresholds enabled.

Replaces: GET /api/auto-trader (base) + parts of /history's "today" usage.

Notes:
- READ-ONLY (`file:...?mode=ro`).
- `equity` = starting_capital + SUM(pnl_usd) over closed live+paper trades.
  Matches the legacy query_auto_trader.py `_equity()` formula so existing
  consumers see the same number.
- "Today" filter: `closed_at >= datetime('now','-1 day')` AND
  `trade_mode='live'` (paper trades excluded from today's tally).
- Open positions count covers BOTH live and paper opens (matches D1's
  capital-hero "Open positions" tile semantics).
- `per_ticker_thresholds_enabled` is read at runtime from
  /home/trevor/trevor/ticker_thresholds.py — no hardcoded drift.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

DB = "/home/trevor/trevor/trevor.db"
STARTING_CAPITAL_FALLBACK = 50.0


def _connect_ro() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=4.0)


def _per_ticker_enabled() -> bool:
    """Runtime import — no hardcoded drift. Matches query_auto_per_ticker_thresholds.py."""
    try:
        sys.path.insert(0, "/home/trevor/trevor")
        import ticker_thresholds as tt  # type: ignore[import-not-found]
        return bool(getattr(tt, "PER_TICKER_THRESHOLDS_ENABLED", False))
    except Exception:
        return False


def main() -> int:
    out = {
        "capital_usd": 0.0,
        "live_capital_usd": 0.0,
        "equity": 0.0,
        "pnl_today_usd": 0.0,
        "pnl_today_pct": 0.0,
        "trades_today": 0,
        "trades_total": 0,
        "open_positions_count": 0,
        "auto_enabled": False,
        "live_enabled": False,
        "killswitch_on": False,
        "per_ticker_thresholds_enabled": False,
        "data_available": False,
    }

    if not Path(DB).exists():
        out["error"] = f"DB not found: {DB}"
        sys.stdout.write(json.dumps(out))
        return 1

    try:
        with _connect_ro() as conn:
            conn.row_factory = sqlite3.Row

            cfg_rows = conn.execute(
                """
                SELECT key, value FROM auto_config
                WHERE key IN (
                    'CAPITAL_USD', 'LIVE_CAPITAL_USD',
                    'AUTO_TRADER_ENABLED', 'AUTO_LIVE_ENABLED',
                    'EMERGENCY_KILLSWITCH'
                )
                """
            ).fetchall()
            cfg = {r["key"]: r["value"] for r in cfg_rows}

            try:
                starting = float(cfg.get("CAPITAL_USD") or STARTING_CAPITAL_FALLBACK)
            except (TypeError, ValueError):
                starting = STARTING_CAPITAL_FALLBACK
            try:
                live_cap = float(cfg.get("LIVE_CAPITAL_USD") or starting)
            except (TypeError, ValueError):
                live_cap = starting

            realized = conn.execute(
                "SELECT COALESCE(SUM(pnl_usd), 0) FROM auto_trades WHERE status='closed'"
            ).fetchone()[0]
            equity = round(starting + float(realized or 0.0), 4)

            today_row = conn.execute(
                """
                SELECT
                    COALESCE(SUM(pnl_usd), 0) AS pnl_usd,
                    COUNT(*) AS n
                FROM auto_trades
                WHERE trade_mode='live'
                  AND status='closed'
                  AND closed_at >= datetime('now','-1 day')
                """
            ).fetchone()

            open_count_row = conn.execute(
                "SELECT COUNT(*) AS n FROM auto_trades WHERE status='open'"
            ).fetchone()

            total_count_row = conn.execute(
                "SELECT COUNT(*) AS n FROM auto_trades WHERE status='closed'"
            ).fetchone()

        pnl_today = round(float(today_row["pnl_usd"] or 0), 4)
        pnl_today_pct = round((pnl_today / live_cap) * 100.0, 4) if live_cap > 0 else 0.0

        out.update({
            "capital_usd": starting,
            "live_capital_usd": live_cap,
            "equity": equity,
            "pnl_today_usd": pnl_today,
            "pnl_today_pct": pnl_today_pct,
            "trades_today": int(today_row["n"] or 0),
            "trades_total": int(total_count_row["n"] or 0),
            "open_positions_count": int(open_count_row["n"] or 0),
            "auto_enabled":  str(cfg.get("AUTO_TRADER_ENABLED", "false")).lower() == "true",
            "live_enabled":  str(cfg.get("AUTO_LIVE_ENABLED", "false")).lower() == "true",
            "killswitch_on": str(cfg.get("EMERGENCY_KILLSWITCH", "false")).lower() == "true",
            "per_ticker_thresholds_enabled": _per_ticker_enabled(),
            "data_available": True,
        })

        sys.stdout.write(json.dumps(out))
        return 0
    except Exception as exc:
        out["error"] = f"{type(exc).__name__}: {exc}"
        sys.stdout.write(json.dumps(out))
        return 1


if __name__ == "__main__":
    sys.exit(main())
