#!/usr/bin/env python3
"""
Consolidated AUTO state for /api/auto/state.

RM-07 P00 (2026-05-28): `equity` is now the LIVE Hyperliquid `accountValue`
(mark-to-market, includes unrealized). `live_capital_usd` is hardcoded to 0
so the Hub's "of $X cap" annotation collapses (the cap is gone). On HL
unreachable, falls back to DB-derived realized P&L for graceful degradation.

Aggregates: live HL balance, today's P&L (live only), trade count today,
open positions count, AUTO_TRADER_ENABLED, AUTO_LIVE_ENABLED,
EMERGENCY_KILLSWITCH, per-ticker thresholds enabled.

Notes:
- READ-ONLY (`file:...?mode=ro`) for SQL paths; HL fetch is a network call.
- "Today" filter: `closed_at >= datetime('now','-1 day')` AND
  `trade_mode='live'` (paper trades excluded from today's tally).
- Open positions count covers BOTH live and paper opens (matches D1's
  capital-hero "Open positions" tile semantics).
- `per_ticker_thresholds_enabled` is read at runtime from
  /home/trevor/trevor/ticker_thresholds.py — no hardcoded drift.
- `pnl_today_pct` denominator is the live HL `accountValue` (zero when HL
  is unreachable → pct collapses to 0.0).
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path

DB = "/home/trevor/trevor/trevor.db"


def _fetch_hl_account_value() -> float | None:
    """Read live HL marginSummary.accountValue. Returns None on any failure."""
    try:
        # Bot venv has hyperliquid + python-dotenv installed
        sys.path.insert(0, "/home/trevor/trevor")
        from dotenv import load_dotenv  # type: ignore[import-not-found]
        from hyperliquid.info import Info  # type: ignore[import-not-found]
        from hyperliquid.utils import constants  # type: ignore[import-not-found]

        load_dotenv("/home/trevor/trevor/.env")
        addr = (
            os.getenv("HL_WALLET_ADDRESS")
            or os.getenv("HL_ADDRESS")
            or os.getenv("HL_ACCOUNT_ADDRESS")
        )
        if not addr:
            return None
        info = Info(constants.MAINNET_API_URL, skip_ws=True)
        state = info.user_state(addr)
        margin = state.get("marginSummary", {})
        return float(margin.get("accountValue", 0.0))
    except Exception:
        return None


def _connect_ro() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10)


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
                    'AUTO_TRADER_ENABLED', 'AUTO_LIVE_ENABLED',
                    'EMERGENCY_KILLSWITCH'
                )
                """
            ).fetchall()
            cfg = {r["key"]: r["value"] for r in cfg_rows}

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

            realized = conn.execute(
                "SELECT COALESCE(SUM(pnl_usd), 0) FROM auto_trades "
                "WHERE trade_mode='live' AND status='closed'"
            ).fetchone()[0]

        # RM-07 P00: prefer live HL accountValue for the Hub display.
        # Fall back to DB-derived realized P&L (no starting-capital anchor)
        # when HL is unreachable. live_capital_usd is hardcoded 0 so the
        # Hub's "of $X cap" annotation collapses (the cap is gone).
        hl_balance = _fetch_hl_account_value()
        equity = round(hl_balance, 4) if hl_balance is not None else round(float(realized or 0.0), 4)

        pnl_today = round(float(today_row["pnl_usd"] or 0), 4)
        pnl_today_pct = round((pnl_today / equity) * 100.0, 4) if equity > 0 else 0.0

        out.update({
            "capital_usd": 0.0,             # RM-07 P00 — vestigial; no starting-capital concept
            "live_capital_usd": 0.0,        # RM-07 P00 — vestigial; collapses Hub "of $X cap" line
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
    # OUTER-WRAP: 2026-05-27 (silent-crash visibility)
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        sys.exit(main())

    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
