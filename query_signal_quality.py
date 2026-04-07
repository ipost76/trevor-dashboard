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
        # Read P&L cutoff (same filter as get_data overall stats)
        _perf_cutoff = None
        try:
            _cr2 = conn.execute(
                "SELECT reset_at_unix FROM capital_resets "
                "WHERE reset_type='pnl_stats' ORDER BY reset_at_unix DESC LIMIT 1"
            ).fetchone()
            if _cr2:
                _perf_cutoff = int(_cr2["reset_at_unix"])
        except Exception:
            pass

        if _perf_cutoff:
            trades = conn.execute("""
                SELECT pnl_pct, leveraged_pnl_pct, exit_reason, created_at
                FROM trade_outcomes WHERE pnl_pct IS NOT NULL
                  AND CAST(strftime('%s', created_at) AS INTEGER) >= ?
                ORDER BY created_at ASC
            """, (_perf_cutoff,)).fetchall()
        else:
            trades = conn.execute("""
                SELECT pnl_pct, leveraged_pnl_pct, exit_reason, created_at
                FROM trade_outcomes WHERE pnl_pct IS NOT NULL
                ORDER BY created_at ASC
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
        # Compound equity return (same fix as overall stats — do not SUM percentages)
        _eq = 1.0
        for _p in pnls:
            _eq *= (1 + _p / 100)
        result["total_pnl_pct"] = round((_eq - 1) * 100, 2)

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

    # P&L cutoff — read from capital_resets table (view-layer reset)
    pnl_cutoff_date = None
    pnl_cutoff_unix = None
    try:
        _cr = conn.execute(
            "SELECT reset_at, reset_at_unix FROM capital_resets "
            "WHERE reset_type='pnl_stats' ORDER BY reset_at_unix DESC LIMIT 1"
        ).fetchone()
        if _cr:
            pnl_cutoff_date = _cr["reset_at"]
            pnl_cutoff_unix = int(_cr["reset_at_unix"])
    except Exception:
        pass  # table may not exist yet — no filter

    # Overall stats — filtered by cutoff if active, ordered by created_at ASC for compounding
    if pnl_cutoff_unix:
        trades = conn.execute("""
            SELECT pnl_pct, leveraged_pnl_pct FROM trade_outcomes
            WHERE pnl_pct IS NOT NULL AND CAST(strftime('%s', created_at) AS INTEGER) >= ?
            ORDER BY created_at ASC
        """, (pnl_cutoff_unix,)).fetchall()
    else:
        trades = conn.execute("""
            SELECT pnl_pct, leveraged_pnl_pct FROM trade_outcomes
            WHERE pnl_pct IS NOT NULL
            ORDER BY created_at ASC
        """).fetchall()

    total = len(trades)
    wins = sum(1 for t in trades if (t['pnl_pct'] or 0) > 0)
    losses = sum(1 for t in trades if (t['pnl_pct'] or 0) <= 0)  # breakeven = loss
    pnls = [float(t['leveraged_pnl_pct'] or t['pnl_pct'] or 0) for t in trades]

    # P&L aggregation: compound equity returns to get true total P&L %.
    # DO NOT SUM individual pnl_pct values — that produces mathematically invalid results
    # (a single trade cannot lose more than 100% un-leveraged, but SUM allows -200%+).
    # Bug fixed 2026-04-07 — was previously displaying -146% on 58 trades.
    # Compound: ((1+r1)(1+r2)...-1) × 100 — always > -100%, correct portfolio metric.
    # Trades compounded in created_at ASC order (chronological).
    equity = 1.0
    for p in pnls:
        equity *= (1 + p / 100)
    total_pnl = round((equity - 1) * 100, 2) if pnls else 0

    win_pnls = [p for p in pnls if p > 0]
    loss_pnls = [p for p in pnls if p < 0]
    # avgPnl is arithmetic mean of per-trade returns (NOT derived from compound total)
    avg_pnl = round(sum(pnls) / total, 2) if total > 0 else 0

    avg_win = round(sum(win_pnls) / len(win_pnls), 2) if win_pnls else 0
    avg_loss_raw = round(sum(loss_pnls) / len(loss_pnls), 2) if loss_pnls else 0
    avg_loss_abs = abs(avg_loss_raw)
    rr_ratio = round(avg_win / avg_loss_abs, 2) if avg_loss_abs > 0 else 0
    wr_dec = wins / total if total > 0 else 0
    expectancy = round(wr_dec * avg_win - (1 - wr_dec) * avg_loss_abs, 2) if total > 0 else 0

    overall = {
        "totalTrades": total,
        "wins": wins,
        "losses": losses,
        "winRate": round(wins / total * 100, 1) if total > 0 else 0,
        "totalPnl": total_pnl,
        "avgPnl": avg_pnl,
        "avgWin": avg_win,
        "avgLoss": avg_loss_raw,
        "profitFactor": round(abs(sum(win_pnls)) / abs(sum(loss_pnls)), 2)
        if loss_pnls and sum(loss_pnls) != 0 else None,
        "rrRatio": rr_ratio,
        "expectancy": expectancy,
        "bestTrade": round(max(pnls), 2) if pnls else 0,
        "worstTrade": round(min(pnls), 2) if pnls else 0,
        "pnlCutoffDate": pnl_cutoff_date,
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

    # Ticker performance — filtered by same cutoff as overall stats
    if pnl_cutoff_unix:
        ticker_rows = conn.execute("""
            SELECT ticker, pnl_pct, leveraged_pnl_pct
            FROM trade_outcomes WHERE pnl_pct IS NOT NULL
              AND CAST(strftime('%s', created_at) AS INTEGER) >= ?
        """, (pnl_cutoff_unix,)).fetchall()
    else:
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
