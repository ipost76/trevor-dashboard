#!/usr/bin/env python3
"""Hub API helper — paper trading portfolio snapshot.

Read-only SQLite access to trevor.db paper_trades / paper_config tables.
Matches the Hub helper pattern: file:?mode=ro, JSON stdout.
"""
import json
import sqlite3
import sys

DB_URI = "file:/home/trevor/trevor/trevor.db?mode=ro"


def _conn():
    c = sqlite3.connect(DB_URI, uri=True)
    c.row_factory = sqlite3.Row
    return c


def snapshot() -> dict:
    try:
        with _conn() as c:
            # Config
            cfg_rows = c.execute("SELECT key, value FROM paper_config").fetchall()
            cfg = {r["key"]: r["value"] for r in cfg_rows}
            enabled = cfg.get("PAPER_TRADING_ENABLED", "false").lower() == "true"
            starting = float(cfg.get("STARTING_EQUITY_USD", 10000))
            position_size = float(cfg.get("POSITION_SIZE_USD", 100))
            max_concurrent = int(float(cfg.get("MAX_CONCURRENT_POSITIONS", 10)))
            max_daily = int(float(cfg.get("MAX_DAILY_TRADES", 50)))

            # Closed aggregates
            closed = c.execute(
                "SELECT COUNT(*) AS n, "
                "COALESCE(SUM(net_pnl_usd),0) AS total_pnl, "
                "SUM(CASE WHEN net_pnl_usd > 0 THEN 1 ELSE 0 END) AS wins, "
                "SUM(CASE WHEN net_pnl_usd <= 0 THEN 1 ELSE 0 END) AS losses "
                "FROM paper_trades WHERE status='closed'"
            ).fetchone()

            n_closed = int(closed["n"] or 0)
            total_pnl = float(closed["total_pnl"] or 0)
            wins = int(closed["wins"] or 0)
            losses = int(closed["losses"] or 0)
            win_rate = (wins / n_closed * 100.0) if n_closed else 0.0
            equity = starting + total_pnl

            # Open positions
            open_rows = c.execute(
                "SELECT id, signal_id, ticker, direction, entry_price, stop_price, "
                "target_price, leverage, confidence, position_size_usd, margin_usd, "
                "regime, opened_at, entry_slippage_bps "
                "FROM paper_trades WHERE status='open' ORDER BY id DESC"
            ).fetchall()
            open_list = [dict(r) for r in open_rows]

            # Recent closed (last 20)
            recent_rows = c.execute(
                "SELECT id, ticker, direction, confidence, leverage, "
                "entry_price, exit_price, exit_reason, "
                "raw_pnl_pct, leveraged_pnl_pct, net_pnl_usd, fees_bps, "
                "hold_minutes, opened_at, closed_at, regime "
                "FROM paper_trades WHERE status='closed' "
                "ORDER BY id DESC LIMIT 20"
            ).fetchall()
            recent_list = [dict(r) for r in recent_rows]

            # By ticker breakdown
            by_ticker_rows = c.execute(
                "SELECT ticker, COUNT(*) AS n, "
                "SUM(CASE WHEN net_pnl_usd > 0 THEN 1 ELSE 0 END) AS wins, "
                "COALESCE(SUM(net_pnl_usd),0) AS pnl, "
                "COALESCE(AVG(leveraged_pnl_pct),0) AS avg_pct "
                "FROM paper_trades WHERE status='closed' "
                "GROUP BY ticker ORDER BY pnl DESC"
            ).fetchall()
            by_ticker = [dict(r) for r in by_ticker_rows]

            # By confidence bucket (critical for Optuna validation)
            by_conf_rows = c.execute(
                "SELECT "
                "CASE WHEN confidence < 45 THEN '<45' "
                "     WHEN confidence < 55 THEN '45-54' "
                "     WHEN confidence < 65 THEN '55-64' "
                "     ELSE '65+' END AS bucket, "
                "COUNT(*) AS n, "
                "SUM(CASE WHEN net_pnl_usd > 0 THEN 1 ELSE 0 END) AS wins, "
                "COALESCE(SUM(net_pnl_usd),0) AS pnl, "
                "COALESCE(AVG(leveraged_pnl_pct),0) AS avg_pct "
                "FROM paper_trades WHERE status='closed' GROUP BY bucket ORDER BY bucket"
            ).fetchall()
            by_confidence_bucket = [dict(r) for r in by_conf_rows]

            # By regime
            by_regime_rows = c.execute(
                "SELECT COALESCE(regime,'?') AS regime, COUNT(*) AS n, "
                "SUM(CASE WHEN net_pnl_usd > 0 THEN 1 ELSE 0 END) AS wins, "
                "COALESCE(SUM(net_pnl_usd),0) AS pnl "
                "FROM paper_trades WHERE status='closed' "
                "GROUP BY regime ORDER BY pnl DESC"
            ).fetchall()
            by_regime = [dict(r) for r in by_regime_rows]

            # Equity curve (cumulative net P&L over closed trades, last 100)
            curve_rows = c.execute(
                "SELECT id, closed_at, net_pnl_usd "
                "FROM paper_trades WHERE status='closed' "
                "ORDER BY id ASC LIMIT 1000"
            ).fetchall()
            equity_curve = []
            running = starting
            for r in curve_rows:
                running += float(r["net_pnl_usd"] or 0)
                equity_curve.append({
                    "id": r["id"],
                    "closed_at": r["closed_at"],
                    "equity": round(running, 2),
                })

            return {
                "enabled": enabled,
                "starting_equity": starting,
                "equity": round(equity, 2),
                "total_pnl_usd": round(total_pnl, 2),
                "closed_positions": n_closed,
                "open_positions": len(open_list),
                "wins": wins,
                "losses": losses,
                "win_rate": round(win_rate, 2),
                "position_size_usd": position_size,
                "max_concurrent": max_concurrent,
                "max_daily": max_daily,
                "open_trades": open_list,
                "recent_closed": recent_list,
                "by_ticker": by_ticker,
                "by_confidence_bucket": by_confidence_bucket,
                "by_regime": by_regime,
                "equity_curve": equity_curve,
            }
    except Exception as e:
        return {"error": str(e), "enabled": False}


if __name__ == "__main__":
    print(json.dumps(snapshot(), default=str))
