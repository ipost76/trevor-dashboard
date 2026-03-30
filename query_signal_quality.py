#!/usr/bin/env python3
"""query_signal_quality.py — Hub API helper for signal quality data."""

import sys
import json
import sqlite3

DB_PATH = "/home/trevor/trevor/trevor.db"


def get_trade_performance(conn):
    """Compute trade performance metrics for the P&L tracker."""
    result = {
        "total_closed": 0, "total_open": 0,
        "win_count": 0, "loss_count": 0,
        "win_rate": 0, "profit_factor": None,
        "avg_winner_pct": 0, "avg_loser_pct": 0,
        "best_trade_pct": 0, "worst_trade_pct": 0,
        "total_pnl_pct": None, "current_streak": 0,
        "capital": None,
        "long_exposure_pct": None, "short_exposure_pct": None,
    }

    try:
        trades = conn.execute("""
            SELECT pnl_pct, leveraged_pnl_pct, exit_reason, created_at
            FROM trade_outcomes WHERE pnl_pct IS NOT NULL
            ORDER BY created_at DESC
        """).fetchall()

        total = len(trades)
        if total == 0:
            return result

        wins = sum(1 for t in trades if (t['exit_reason'] or '').upper() == 'WIN')
        losses = sum(1 for t in trades if (t['exit_reason'] or '').upper() == 'LOSS')
        pnls = [float(t['leveraged_pnl_pct'] or t['pnl_pct'] or 0) for t in trades]
        win_pnls = [p for p in pnls if p > 0]
        loss_pnls = [p for p in pnls if p < 0]

        result["total_closed"] = total
        result["win_count"] = wins
        result["loss_count"] = losses
        result["win_rate"] = round(wins / total * 100, 1) if total > 0 else 0
        result["avg_winner_pct"] = round(sum(win_pnls) / len(win_pnls), 2) if win_pnls else 0
        result["avg_loser_pct"] = round(sum(loss_pnls) / len(loss_pnls), 2) if loss_pnls else 0
        result["best_trade_pct"] = round(max(pnls), 2) if pnls else 0
        result["worst_trade_pct"] = round(min(pnls), 2) if pnls else 0
        result["total_pnl_pct"] = round(sum(pnls), 2)

        if loss_pnls and sum(loss_pnls) != 0:
            result["profit_factor"] = round(abs(sum(win_pnls)) / abs(sum(loss_pnls)), 2)

        # Current streak: count consecutive same exit_reason from most recent
        streak = 0
        if trades:
            first_result = (trades[0]['exit_reason'] or '').upper()
            if first_result in ('WIN', 'LOSS'):
                for t in trades:
                    r = (t['exit_reason'] or '').upper()
                    if r == first_result:
                        streak += 1
                    else:
                        break
                if first_result == 'LOSS':
                    streak = -streak
        result["current_streak"] = streak
    except Exception:
        pass

    # Open trades count
    try:
        row = conn.execute("SELECT COUNT(*) FROM active_trades WHERE status='open'").fetchone()
        result["total_open"] = row[0] if row else 0
    except Exception:
        pass

    # Capital
    try:
        row = conn.execute("SELECT value FROM trevor_config WHERE key='trading_capital'").fetchone()
        if row:
            result["capital"] = round(float(row[0]), 2)
    except Exception:
        pass

    # Exposure (margin_usd by direction as % of capital)
    try:
        capital = result["capital"]
        if capital and capital > 0:
            rows = conn.execute("""
                SELECT direction, SUM(margin_usd) as total_margin
                FROM active_trades
                WHERE status='open' AND margin_usd IS NOT NULL AND margin_usd > 0
                GROUP BY direction
            """).fetchall()
            for r in rows:
                d = (r['direction'] or '').upper()
                pct = round(float(r['total_margin'] or 0) / capital * 100, 1)
                if d == 'LONG':
                    result["long_exposure_pct"] = pct
                elif d == 'SHORT':
                    result["short_exposure_pct"] = pct
    except Exception:
        pass

    return result


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
    losses = sum(1 for t in trades if (t['pnl_pct'] or 0) < 0)
    pnls = [float(t['leveraged_pnl_pct'] or t['pnl_pct'] or 0) for t in trades]
    total_pnl = sum(pnls)
    win_pnls = [p for p in pnls if p > 0]
    loss_pnls = [p for p in pnls if p < 0]

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
    for label in ["35-45", "45-55", "55-65", "65-75", "75+"]:
        buckets[label] = {"trades": 0, "wins": 0}

    for r in cal_rows:
        conf = float(r['confidence'] or 0)
        if conf <= 1.0:
            conf *= 100
        is_win = (r['pnl_pct'] or 0) > 0

        if conf < 35: continue
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

    # Trade performance for P&L tracker
    trade_perf = get_trade_performance(conn)

    # Expectancy calculation
    avg_win = round(sum(win_pnls) / len(win_pnls), 2) if win_pnls else 0
    avg_loss = round(sum(loss_pnls) / len(loss_pnls), 2) if loss_pnls else 0
    wr_dec = wins / total if total > 0 else 0
    exp_pct = (wr_dec * avg_win) + ((1 - wr_dec) * avg_loss) if total > 0 else 0
    breakeven_wr = (abs(avg_loss) / (avg_win + abs(avg_loss)) * 100) if (avg_win + abs(avg_loss)) > 0 else 50
    expectancy = {
        "per_trade_pct": round(exp_pct, 2),
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "win_rate": round(wr_dec * 100, 1),
        "breakeven_wr": round(breakeven_wr, 1),
        "interpretation": "Negative edge" if exp_pct < -0.5 else ("Positive edge" if exp_pct > 0.5 else "Near breakeven"),
    }

    # Circuit breaker status
    circuit_breakers = []
    try:
        import sys
        sys.path.insert(0, '/home/trevor/trevor')
        from confidence_calibrator import get_circuit_breaker_status
        circuit_breakers = get_circuit_breaker_status()
    except Exception:
        pass

    conn.close()

    return {
        "overall": overall,
        "calibration": buckets,
        "tickerPerformance": ticker_perf,
        "tradePerformance": trade_perf,
        "expectancy": expectancy,
        "circuitBreakers": circuit_breakers,
    }


if __name__ == "__main__":
    print(json.dumps(get_data()))
