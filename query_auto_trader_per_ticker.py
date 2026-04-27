#!/usr/bin/env python3
"""
Query helper for AutoTrader per-ticker performance breakdown.

For each of the 5 sacred tickers (BTC/ETH/SOL/HYPE/FARTCOIN), returns:
  ticker, trades, wins, losses, win_rate (0-100),
  total_pnl, avg_win, avg_loss, best_trade, worst_trade,
  equity_points [{x: trade_idx, y: cumulative_pnl_usd}] up to 60 points

Mode filter: all | live | paper (default all).
READ-ONLY (mode=ro URI). Pure SQL aggregates over auto_trades.
"""
from __future__ import annotations

import json
import sqlite3
import sys

DB_PATH = "/home/trevor/trevor/trevor.db"
SACRED_TICKERS = ["BTC", "ETH", "SOL", "HYPE", "FARTCOIN"]
ALLOWED_MODES = {"all", "live", "paper"}
EQUITY_POINTS_MAX = 60


def query_per_ticker(mode: str = "all") -> list[dict]:
    out: list[dict] = []
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=5.0)
    conn.row_factory = sqlite3.Row
    try:
        for ticker in SACRED_TICKERS:
            mode_filter = ""
            params: list = [ticker]
            if mode in ("live", "paper"):
                mode_filter = " AND trade_mode = ?"
                params.append(mode)

            # Aggregates
            agg_sql = (
                "SELECT COUNT(*) AS n, "
                "SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) AS wins, "
                "SUM(CASE WHEN pnl_usd <= 0 THEN 1 ELSE 0 END) AS losses, "
                "SUM(pnl_usd) AS total_pnl, "
                "AVG(CASE WHEN pnl_usd > 0 THEN pnl_usd END) AS avg_win, "
                "AVG(CASE WHEN pnl_usd <= 0 THEN pnl_usd END) AS avg_loss, "
                "MAX(pnl_usd) AS best, MIN(pnl_usd) AS worst "
                "FROM auto_trades "
                "WHERE ticker = ? AND status = 'closed'" + mode_filter
            )
            row = conn.execute(agg_sql, tuple(params)).fetchone()
            n = int(row["n"] or 0)

            # Chronological pnls for sparkline (running cumulative)
            equity_sql = (
                "SELECT pnl_usd FROM auto_trades "
                "WHERE ticker = ? AND status = 'closed'" + mode_filter +
                " ORDER BY closed_at ASC"
            )
            pnls = [
                float(r["pnl_usd"] or 0)
                for r in conn.execute(equity_sql, tuple(params)).fetchall()
            ]
            recent = pnls[-EQUITY_POINTS_MAX:] if len(pnls) > EQUITY_POINTS_MAX else pnls
            cum = 0.0
            equity_points: list[dict] = []
            for i, p in enumerate(recent):
                cum += p
                equity_points.append({"x": i, "y": round(cum, 4)})

            wins = int(row["wins"] or 0)
            losses = int(row["losses"] or 0)
            wr = (wins / n * 100.0) if n > 0 else 0.0

            out.append(
                {
                    "ticker": ticker,
                    "trades": n,
                    "wins": wins,
                    "losses": losses,
                    "win_rate": round(wr, 1),
                    "total_pnl": round(float(row["total_pnl"] or 0), 4),
                    "avg_win": round(float(row["avg_win"] or 0), 4),
                    "avg_loss": round(float(row["avg_loss"] or 0), 4),
                    "best_trade": round(float(row["best"] or 0), 4),
                    "worst_trade": round(float(row["worst"] or 0), 4),
                    "equity_points": equity_points,
                }
            )
        return out
    finally:
        conn.close()


def main() -> int:
    mode = "all"
    if len(sys.argv) > 1:
        m = sys.argv[1].strip().lower()
        if m in ALLOWED_MODES:
            mode = m
    try:
        data = query_per_ticker(mode=mode)
        print(json.dumps({"tickers": data, "mode": mode}))
        return 0
    except Exception as e:
        print(json.dumps({"tickers": [], "mode": mode, "error": str(e)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
