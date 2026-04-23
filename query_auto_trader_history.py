#!/usr/bin/env python3
"""
Hub helper for the Auto Trader P2 analytics + history endpoints (2026-04-23).

READ-ONLY queries over auto_trades. One file, three scopes:

    python3 query_auto_trader_history.py equity-curve
    python3 query_auto_trader_history.py analytics
    python3 query_auto_trader_history.py history [page] [limit] [filter] [period]
        filter: all | winners | losers (default all)
        period: all | 7d | 30d          (default all)

All responses are JSON on stdout. Errors return {"error": "..."} with exit 1.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path

DB_PATH = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")
STARTING_CAPITAL_FALLBACK = 50.0

# Canonical exit reasons — seeded at count=0 when absent so the chart
# always shows the full executor surface. Any DB reason not in this list
# is merged in with a sign-based color.
CANONICAL_EXIT_REASONS: list[tuple[str, str]] = [
    ("timeout_240min", "#ffaa00"),   # amber
    ("stop_hit", "#ff3366"),          # red
    ("trailing_stop", "#00aaff"),     # blue
    ("tech_signals", "#00f0ff"),      # cyan
    ("partial_profit", "#00ff88"),    # green
]

DETAIL_COLS = [
    "id", "ticker", "direction", "entry_price", "exit_price", "leverage",
    "notional_usd", "original_notional_usd", "confidence", "adjusted_confidence",
    "pnl_usd", "pnl_pct", "fees_usd", "exit_reason", "hold_duration_minutes",
    "peak_pnl_pct", "peak_price", "trough_price", "partial_exits_taken",
    "partial_pnl_realized", "breakeven_stop_active", "regime_at_entry",
    "market_state", "opened_at", "closed_at",
]


def _connect_ro() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=5.0)


def _starting_capital(conn: sqlite3.Connection) -> float:
    try:
        row = conn.execute(
            "SELECT value FROM auto_config WHERE key = 'CAPITAL_USD'"
        ).fetchone()
        return float(row[0]) if row and row[0] else STARTING_CAPITAL_FALLBACK
    except (sqlite3.OperationalError, TypeError, ValueError):
        return STARTING_CAPITAL_FALLBACK


# ─────────────────────────── equity curve ───────────────────────────
def equity_curve(conn: sqlite3.Connection) -> dict:
    starting = _starting_capital(conn)
    try:
        rows = conn.execute(
            "SELECT id, ticker, direction, pnl_usd, closed_at "
            "FROM auto_trades WHERE status = 'closed' "
            "ORDER BY closed_at ASC"
        ).fetchall()
    except sqlite3.OperationalError:
        rows = []

    points = []
    running = starting
    for r in rows:
        pnl = float(r[3] or 0.0)
        running += pnl
        points.append({
            "trade_id": r[0],
            "ticker": r[1],
            "direction": r[2],
            "pnl_usd": round(pnl, 4),
            "closed_at": r[4],
            "equity": round(running, 4),
            "pnl_cumulative": round(running - starting, 4),
        })
    return {
        "points": points,
        "starting_capital": round(starting, 4),
        "current_equity": round(running, 4),
        "total_trades": len(points),
    }


# ─────────────────────────── analytics ──────────────────────────────
def analytics(conn: sqlite3.Connection) -> dict:
    # by_ticker
    by_ticker = []
    try:
        for row in conn.execute(
            "SELECT ticker, COUNT(*), "
            "  SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END), "
            "  SUM(CASE WHEN pnl_usd <= 0 THEN 1 ELSE 0 END), "
            "  COALESCE(SUM(pnl_usd), 0), "
            "  COALESCE(AVG(pnl_pct), 0) "
            "FROM auto_trades WHERE status = 'closed' "
            "GROUP BY ticker ORDER BY COUNT(*) DESC"
        ):
            total = int(row[1] or 0)
            wins = int(row[2] or 0)
            by_ticker.append({
                "ticker": row[0],
                "total": total,
                "wins": wins,
                "losses": int(row[3] or 0),
                "win_rate": round((wins / total) * 100.0, 1) if total else 0.0,
                "total_pnl": round(float(row[4] or 0), 4),
                "avg_pnl_pct": round(float(row[5] or 0), 2),
            })
    except sqlite3.OperationalError:
        pass

    # by_exit_reason — start with canonical list at zero, merge DB data
    reason_map: dict[str, dict] = {
        name: {"reason": name, "count": 0, "total_pnl": 0.0,
               "avg_pnl_pct": 0.0, "color": color}
        for name, color in CANONICAL_EXIT_REASONS
    }
    try:
        for row in conn.execute(
            "SELECT COALESCE(exit_reason, 'unknown'), COUNT(*), "
            "COALESCE(SUM(pnl_usd), 0), COALESCE(AVG(pnl_pct), 0) "
            "FROM auto_trades WHERE status = 'closed' "
            "GROUP BY exit_reason"
        ):
            reason = row[0] or "unknown"
            count = int(row[1] or 0)
            total_pnl = float(row[2] or 0)
            avg_pct = float(row[3] or 0)
            color_default = "#00ff88" if total_pnl >= 0 else "#ff3366"
            entry = reason_map.get(reason)
            if entry is None:
                reason_map[reason] = {
                    "reason": reason,
                    "count": count,
                    "total_pnl": round(total_pnl, 4),
                    "avg_pnl_pct": round(avg_pct, 2),
                    "color": color_default,
                }
            else:
                entry["count"] = count
                entry["total_pnl"] = round(total_pnl, 4)
                entry["avg_pnl_pct"] = round(avg_pct, 2)
    except sqlite3.OperationalError:
        pass
    by_exit_reason = sorted(
        reason_map.values(),
        key=lambda r: r["total_pnl"],
        reverse=True,
    )

    # overall
    overall = {
        "total_trades": 0, "wins": 0, "losses": 0, "win_rate": 0.0,
        "total_pnl": 0.0, "best_trade": None, "worst_trade": None,
        "avg_hold_minutes": 0.0, "avg_winner_pnl": 0.0,
        "avg_loser_pnl": 0.0, "profit_factor": 0.0,
    }
    try:
        rows = conn.execute(
            "SELECT id, ticker, direction, pnl_usd, pnl_pct, "
            "hold_duration_minutes FROM auto_trades WHERE status = 'closed'"
        ).fetchall()
    except sqlite3.OperationalError:
        rows = []

    if rows:
        pnls_usd = [float(r[3] or 0) for r in rows]
        pnls_pct = [float(r[4] or 0) for r in rows]
        holds = [float(r[5] or 0) for r in rows if r[5] is not None]
        winners = [float(r[3] or 0) for r in rows if (r[3] or 0) > 0]
        losers = [float(r[3] or 0) for r in rows if (r[3] or 0) <= 0]
        best_i = max(range(len(rows)), key=lambda i: pnls_pct[i])
        worst_i = min(range(len(rows)), key=lambda i: pnls_pct[i])

        winning_sum = sum(w for w in winners)
        losing_sum = sum(abs(l) for l in losers)
        profit_factor = (
            round(winning_sum / losing_sum, 3) if losing_sum > 0 else
            (float("inf") if winning_sum > 0 else 0.0)
        )

        overall = {
            "total_trades": len(rows),
            "wins": len(winners),
            "losses": len(losers),
            "win_rate": round(len(winners) / len(rows) * 100.0, 1),
            "total_pnl": round(sum(pnls_usd), 4),
            "best_trade": {
                "id": rows[best_i][0],
                "ticker": rows[best_i][1],
                "direction": rows[best_i][2],
                "pnl_usd": round(pnls_usd[best_i], 4),
                "pnl_pct": round(pnls_pct[best_i], 2),
            },
            "worst_trade": {
                "id": rows[worst_i][0],
                "ticker": rows[worst_i][1],
                "direction": rows[worst_i][2],
                "pnl_usd": round(pnls_usd[worst_i], 4),
                "pnl_pct": round(pnls_pct[worst_i], 2),
            },
            "avg_hold_minutes": round(sum(holds) / len(holds), 1) if holds else 0.0,
            "avg_winner_pnl": round(sum(winners) / len(winners), 4) if winners else 0.0,
            "avg_loser_pnl": round(sum(losers) / len(losers), 4) if losers else 0.0,
            "profit_factor": profit_factor if profit_factor != float("inf") else None,
        }

    return {
        "by_ticker": by_ticker,
        "by_exit_reason": by_exit_reason,
        "overall": overall,
    }


# ─────────────────────────── history ────────────────────────────────
def _period_clause(period: str) -> str:
    if period == "7d":
        return "AND closed_at >= datetime('now', '-7 days')"
    if period == "30d":
        return "AND closed_at >= datetime('now', '-30 days')"
    return ""  # 'all'


def _filter_clause(filt: str) -> str:
    if filt == "winners":
        return "AND pnl_usd > 0"
    if filt == "losers":
        return "AND pnl_usd <= 0"
    return ""  # 'all'


def history(conn: sqlite3.Connection, page: int, limit: int,
            filt: str, period: str) -> dict:
    where_extra = f"{_filter_clause(filt)} {_period_clause(period)}".strip()
    offset = max(0, (page - 1) * limit)

    try:
        total_row = conn.execute(
            f"SELECT COUNT(*) FROM auto_trades "
            f"WHERE status = 'closed' {where_extra}"
        ).fetchone()
        total = int(total_row[0] or 0)
    except sqlite3.OperationalError:
        total = 0

    trades: list[dict] = []
    try:
        cols = ", ".join(DETAIL_COLS)
        cur = conn.execute(
            f"SELECT {cols} FROM auto_trades "
            f"WHERE status = 'closed' {where_extra} "
            "ORDER BY closed_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        )
        for row in cur.fetchall():
            d = {DETAIL_COLS[i]: row[i] for i in range(len(DETAIL_COLS))}
            # Coerce breakeven_stop_active to bool for consistency
            d["breakeven_stop_active"] = bool(d.get("breakeven_stop_active") or 0)
            trades.append(d)
    except sqlite3.OperationalError:
        trades = []

    pages = (total + limit - 1) // limit if limit > 0 else 1

    return {
        "trades": trades,
        "total": total,
        "page": page,
        "pages": pages,
        "limit": limit,
        "filter": filt,
        "period": period,
        "has_more": (page < pages),
    }


# ─────────────────────────── entry ──────────────────────────────────
def main() -> int:
    scope = sys.argv[1] if len(sys.argv) > 1 else "analytics"

    if not Path(DB_PATH).exists():
        sys.stdout.write(json.dumps({"error": f"DB not found: {DB_PATH}"}))
        return 1

    conn = _connect_ro()
    try:
        if scope == "equity-curve":
            out = equity_curve(conn)
        elif scope == "analytics":
            out = analytics(conn)
        elif scope == "history":
            # args: page limit filter period
            try:
                page = int(sys.argv[2]) if len(sys.argv) > 2 else 1
                limit = int(sys.argv[3]) if len(sys.argv) > 3 else 20
            except ValueError:
                page, limit = 1, 20
            filt = sys.argv[4] if len(sys.argv) > 4 else "all"
            period = sys.argv[5] if len(sys.argv) > 5 else "all"
            page = max(1, page)
            limit = max(1, min(100, limit))
            if filt not in ("all", "winners", "losers"):
                filt = "all"
            if period not in ("all", "7d", "30d"):
                period = "all"
            out = history(conn, page, limit, filt, period)
        else:
            sys.stdout.write(json.dumps(
                {"error": f"unknown scope: {scope}"}))
            return 1
        sys.stdout.write(json.dumps(out, default=str))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
