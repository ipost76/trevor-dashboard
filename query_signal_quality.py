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

    # Calibration
    cal_rows = conn.execute("""
        SELECT ti.confidence, to2.pnl_pct
        FROM trade_outcomes to2
        JOIN trade_insights ti ON to2.insight_id = ti.id
        WHERE ti.confidence IS NOT NULL AND to2.pnl_pct IS NOT NULL
    """).fetchall()

    buckets = {}
    for label in ["50-60", "60-70", "70-80", "80-90", "90+"]:
        buckets[label] = {"trades": 0, "wins": 0}

    for r in cal_rows:
        conf = float(r['confidence'] or 0)
        if conf <= 1.0:
            conf *= 100
        is_win = (r['pnl_pct'] or 0) > 0

        bucket = None
        if 50 <= conf < 60: bucket = "50-60"
        elif 60 <= conf < 70: bucket = "60-70"
        elif 70 <= conf < 80: bucket = "70-80"
        elif 80 <= conf < 90: bucket = "80-90"
        elif conf >= 90: bucket = "90+"

        if bucket:
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
        sym = t['ticker'] or 'UNKNOWN'
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
