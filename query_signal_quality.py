#!/usr/bin/env python3
"""query_signal_quality.py — Hub API helper for signal quality data."""

import sys
import json
import sqlite3

DB_PATH = "/home/trevor/trevor/trevor.db"


def get_data():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # Overall stats
    trades = conn.execute("""
        SELECT pnl_pct, leveraged_pnl_pct FROM trade_outcomes
        WHERE pnl_pct IS NOT NULL
    """).fetchall()

    total = len(trades)
    wins = sum(1 for t in trades if (t['pnl_pct'] or 0) > 0)
    losses = total - wins
    pnls = [float(t['leveraged_pnl_pct'] or t['pnl_pct'] or 0) for t in trades]
    total_pnl = sum(pnls)
    win_pnls = [p for p in pnls if p > 0]
    loss_pnls = [p for p in pnls if p <= 0]

    overall = {
        "totalTrades": total,
        "wins": wins,
        "losses": losses,
        "winRate": round(wins / total * 100, 1) if total > 0 else 0,
        "totalPnl": round(total_pnl, 2),
        "avgPnl": round(total_pnl / total, 2) if total > 0 else 0,
        "avgWin": round(sum(win_pnls) / len(win_pnls), 2) if win_pnls else 0,
        "avgLoss": round(sum(loss_pnls) / len(loss_pnls), 2) if loss_pnls else 0,
        "profitFactor": round(abs(sum(win_pnls)) / abs(sum(loss_pnls)), 2)
        if loss_pnls and sum(loss_pnls) != 0 else None,
    }

    # Calibration — use active_trades (has confidence + pnl_pct for closed trades)
    cal_rows = conn.execute("""
        SELECT confidence, pnl_pct
        FROM active_trades
        WHERE status = 'closed' AND confidence IS NOT NULL AND pnl_pct IS NOT NULL
    """).fetchall()

    buckets = {}
    for label in ["<35", "35-45", "45-55", "55-65", "65-75", "75+"]:
        buckets[label] = {"trades": 0, "wins": 0}

    for r in cal_rows:
        conf = float(r['confidence'] or 0)
        if conf <= 1.0:
            conf *= 100
        is_win = (r['pnl_pct'] or 0) > 0

        if conf < 35: bucket = "<35"
        elif conf < 45: bucket = "35-45"
        elif conf < 55: bucket = "45-55"
        elif conf < 65: bucket = "55-65"
        elif conf < 75: bucket = "65-75"
        else: bucket = "75+"

        buckets[bucket]["trades"] += 1
        if is_win:
            buckets[bucket]["wins"] += 1

    for data in buckets.values():
        data["winRate"] = round(data["wins"] / data["trades"] * 100, 1) if data["trades"] > 0 else None

    # Ticker performance
    ticker_rows = conn.execute("""
        SELECT ticker, pnl_pct, leveraged_pnl_pct
        FROM trade_outcomes WHERE pnl_pct IS NOT NULL
    """).fetchall()

    ticker_map = {}
    for t in ticker_rows:
        sym = (t['ticker'] or 'UNKNOWN').replace('-PERP', '').replace('/USD', '').upper()
        if sym not in ticker_map:
            ticker_map[sym] = {"trades": 0, "wins": 0, "pnl": 0.0}
        ticker_map[sym]["trades"] += 1
        if (t['pnl_pct'] or 0) > 0:
            ticker_map[sym]["wins"] += 1
        ticker_map[sym]["pnl"] += float(t['leveraged_pnl_pct'] or t['pnl_pct'] or 0)

    ticker_perf = sorted(
        [{"symbol": sym, "trades": d["trades"], "wins": d["wins"],
          "winRate": round(d["wins"] / d["trades"] * 100, 1) if d["trades"] > 0 else 0,
          "totalPnl": round(d["pnl"], 2)}
         for sym, d in ticker_map.items()],
        key=lambda x: x["trades"], reverse=True
    )

    conn.close()

    return {
        "overall": overall,
        "calibration": buckets,
        "tickerPerformance": ticker_perf,
    }


if __name__ == "__main__":
    print(json.dumps(get_data()))
