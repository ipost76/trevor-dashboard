#!/usr/bin/env python3
"""Trade data query helper for Mission Control dashboard. READ ONLY."""
import sqlite3, json, sys, os

def main():
    scope = sys.argv[1] if len(sys.argv) > 1 else "active"
    db_path = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")

    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row

    if scope == "active":
        result = {"trades": [], "stats": {}, "recentSignals": []}

        # Stats from trade_outcomes
        try:
            row = conn.execute("""
                SELECT COUNT(*) as total,
                       SUM(CASE WHEN exit_reason='WIN' THEN 1 ELSE 0 END) as wins,
                       SUM(CASE WHEN exit_reason='LOSS' THEN 1 ELSE 0 END) as losses,
                       SUM(CASE WHEN exit_reason='SCRATCH' THEN 1 ELSE 0 END) as scratches,
                       COALESCE(AVG(pnl_pct), 0) as avg_pnl,
                       COALESCE(SUM(pnl_pct), 0) as total_pnl
                FROM trade_outcomes
            """).fetchone()
            if row:
                total = row["total"] or 0
                wins = row["wins"] or 0
                losses = row["losses"] or 0
                decided = wins + losses
                result["stats"] = {
                    "total": total, "wins": wins, "losses": losses,
                    "scratches": row["scratches"] or 0,
                    "winRate": round((wins / decided) * 100, 1) if decided > 0 else 0,
                    "avgPnl": round(float(row["avg_pnl"] or 0), 2),
                    "totalPnl": round(float(row["total_pnl"] or 0), 2),
                }
        except Exception:
            result["stats"] = {"total": 0, "wins": 0, "losses": 0, "scratches": 0, "winRate": 0, "avgPnl": 0, "totalPnl": 0}

        # Recent trade insights as signals
        try:
            rows = conn.execute("""
                SELECT id, ticker, signal_type, confidence, entry_price,
                       target_price, stop_price, strategy, timeframe, outcome, created_at
                FROM trade_insights ORDER BY created_at DESC LIMIT 10
            """).fetchall()
            result["recentSignals"] = [dict(r) for r in rows]
        except Exception:
            pass

        conn.close()
        print(json.dumps(result))

    elif scope == "history":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 50
        offset = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        filters = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}

        conditions = ["1=1"]
        if filters.get("ticker"):
            conditions.append(f"ticker='{filters['ticker']}'")
        if filters.get("outcome"):
            conditions.append(f"exit_reason='{filters['outcome']}'")
        if filters.get("direction"):
            conditions.append(f"direction='{filters['direction']}'")

        where = " AND ".join(conditions)

        try:
            total = conn.execute(f"SELECT COUNT(*) FROM trade_outcomes WHERE {where}").fetchone()[0]
            rows = conn.execute(f"""
                SELECT id, ticker, direction, entry_price, exit_price, open_price, close_price,
                       pnl_pct, leverage, raw_pnl_pct, leveraged_pnl_pct,
                       exit_reason, lessons, created_at
                FROM trade_outcomes WHERE {where}
                ORDER BY created_at DESC LIMIT {limit} OFFSET {offset}
            """).fetchall()
            records = []
            for r in rows:
                d = dict(r)
                d["entry_price"] = d["entry_price"] or d["open_price"]
                d["exit_price"] = d["exit_price"] or d["close_price"]
                records.append(d)
        except Exception:
            total = 0
            records = []

        conn.close()
        print(json.dumps({"records": records, "total": total}))

    elif scope == "watchlist":
        try:
            rows = conn.execute("""
                SELECT id, ticker, reason, priority, mode, asset_type, notes, last_checked, added_at
                FROM watchlist ORDER BY mode, ticker
            """).fetchall()
            items = [dict(r) for r in rows]
        except Exception:
            items = []
        conn.close()
        print(json.dumps({"items": items}))

    elif scope == "signals":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 50
        offset = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        filters = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}

        conditions = ["1=1"]
        if filters.get("ticker"):
            conditions.append(f"ticker='{filters['ticker']}'")
        if filters.get("signal_type"):
            conditions.append(f"signal_type='{filters['signal_type']}'")

        where = " AND ".join(conditions)

        try:
            total = conn.execute(f"SELECT COUNT(*) FROM trade_insights WHERE {where}").fetchone()[0]
            rows = conn.execute(f"""
                SELECT id, ticker, signal_type, confidence, entry_price,
                       target_price, stop_price, strategy, timeframe,
                       outcome, actual_result_pct, created_at
                FROM trade_insights WHERE {where}
                ORDER BY created_at DESC LIMIT {limit} OFFSET {offset}
            """).fetchall()
            records = []
            for r in rows:
                d = dict(r)
                conf = d.get("confidence")
                if conf is not None and conf <= 1:
                    d["confidence"] = round(float(conf) * 100)
                records.append(d)
        except Exception:
            total = 0
            records = []

        conn.close()
        print(json.dumps({"records": records, "total": total}))

    else:
        conn.close()
        print(json.dumps({"error": f"Unknown scope: {scope}"}))

if __name__ == "__main__":
    main()
