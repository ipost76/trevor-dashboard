#!/usr/bin/env python3
"""Trade data query helper for Mission Control dashboard."""
import sqlite3, json, sys, os

def main():
    scope = sys.argv[1] if len(sys.argv) > 1 else "active"
    trevor_dir = os.environ.get("TREVOR_PROJECT_DIR", "/home/trevor/trevor")
    db_path = os.environ.get("TREVOR_DB_PATH", os.path.join(trevor_dir, "trevor.db"))

    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row

    if scope == "active":
        # Active trades from active_trades table (persisted on TAKE/BUILDING)
        result = {"trades": [], "stats": {}}
        try:
            rows = conn.execute("""
                SELECT trade_id, ticker, direction, entry_price, stop_price, target_price,
                       leverage, confidence, track, opened_at, status,
                       dynamic_target, target_pct, atr_at_entry, regime_at_entry,
                       peak_pnl_lev, last_exit_condition, last_exit_severity,
                       profit_target_price, entry_groups, margin_usd
                FROM active_trades
                WHERE status = 'open'
                ORDER BY opened_at DESC
            """).fetchall()
            result["trades"] = [dict(r) for r in rows]
        except Exception:
            pass

        # Stats from trade_outcomes
        try:
            row = conn.execute("""
                SELECT COUNT(*) as total,
                       SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) as wins,
                       SUM(CASE WHEN outcome='LOSS' THEN 1 ELSE 0 END) as losses,
                       SUM(CASE WHEN outcome='SCRATCH' THEN 1 ELSE 0 END) as scratches,
                       AVG(CASE WHEN pnl_pct IS NOT NULL THEN pnl_pct ELSE 0 END) as avg_pnl,
                       SUM(CASE WHEN pnl_pct IS NOT NULL THEN pnl_pct ELSE 0 END) as total_pnl
                FROM trade_outcomes
            """).fetchone()
            if row:
                total = row["total"] or 0
                wins = row["wins"] or 0
                losses = row["losses"] or 0
                decided = wins + losses
                result["stats"] = {
                    "total": total,
                    "wins": wins,
                    "losses": losses,
                    "scratches": row["scratches"] or 0,
                    "winRate": round((wins / decided) * 100, 1) if decided > 0 else 0,
                    "avgPnl": round(float(row["avg_pnl"] or 0), 2),
                    "totalPnl": round(float(row["total_pnl"] or 0), 2),
                    "activeCount": len(result["trades"]),
                }
        except Exception:
            result["stats"] = {"total": 0, "wins": 0, "losses": 0, "scratches": 0, "winRate": 0, "avgPnl": 0, "totalPnl": 0, "activeCount": 0}

        # Recent signals (last 24h only)
        try:
            rows = conn.execute("""
                SELECT ticker, direction, signal_type, confidence, timestamp, mode
                FROM alert_outcomes
                WHERE fired_at > datetime('now', '-24 hours')
                ORDER BY fired_at DESC
                LIMIT 10
            """).fetchall()
            result["recentSignals"] = [dict(r) for r in rows]
        except Exception:
            result["recentSignals"] = []

        conn.close()
        print(json.dumps(result))

    elif scope == "history":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 50
        offset = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        filters = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}

        conditions = ["status = 'closed'"]
        if filters.get("ticker"):
            conditions.append(f"ticker LIKE '%{filters['ticker']}%'")
        if filters.get("outcome"):
            if filters["outcome"] == "WIN":
                conditions.append("pnl_pct > 0")
            elif filters["outcome"] == "LOSS":
                conditions.append("pnl_pct <= 0")
        if filters.get("direction"):
            conditions.append(f"direction='{filters['direction']}'")

        where = " AND ".join(conditions)

        try:
            total = conn.execute(f"SELECT COUNT(*) FROM active_trades WHERE {where}").fetchone()[0]
            rows = conn.execute(f"""
                SELECT trade_id, ticker, direction, entry_price, exit_price, pnl_pct,
                       leverage, confidence, opened_at as created_at, closed_at, track
                FROM active_trades WHERE {where}
                ORDER BY closed_at DESC LIMIT {limit} OFFSET {offset}
            """).fetchall()
            records = []
            for r in rows:
                d = dict(r)
                d["outcome"] = "WIN" if (d.get("pnl_pct") or 0) > 0 else "LOSS"
                d["leveraged_pnl_pct"] = round(d.get("pnl_pct") or 0, 2)
                records.append(d)
        except Exception as e:
            total = 0
            records = []

        conn.close()
        print(json.dumps({"records": records, "total": total}))

    elif scope == "watchlist":
        try:
            rows = conn.execute("""
                SELECT ticker, mode, added_at, notes
                FROM watchlist
                ORDER BY mode, ticker
            """).fetchall()
            items = [dict(r) for r in rows]
        except Exception:
            items = []
        conn.close()
        print(json.dumps({"items": items}))

    elif scope == "annotate":
        data = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
        trade_id = data.get("id")
        notes = data.get("notes")
        training_status = data.get("training_status")
        if trade_id is None:
            conn.close()
            print(json.dumps({"error": "Missing trade id"}))
            return
        conn.close()
        conn_rw = sqlite3.connect(db_path)
        try:
            conn_rw.execute(
                "UPDATE trade_outcomes SET notes=?, training_status=? WHERE rowid=?",
                (notes, training_status, int(trade_id))
            )
            conn_rw.commit()
            print(json.dumps({"ok": True, "updated": trade_id}))
        except Exception as e:
            print(json.dumps({"error": str(e)}))
        finally:
            conn_rw.close()

    elif scope == "delete_trade":
        trade_id = int(sys.argv[2]) if len(sys.argv) > 2 else None
        if trade_id is None:
            conn.close()
            print(json.dumps({"error": "Missing trade id"}))
            return
        # Read ticker before deleting (conn is read-only, fine for SELECT)
        try:
            row = conn.execute("SELECT ticker FROM trade_outcomes WHERE rowid=?", (trade_id,)).fetchone()
            ticker = row["ticker"] if row else None
        except Exception:
            ticker = None
        conn.close()
        conn_rw = sqlite3.connect(db_path)
        try:
            conn_rw.execute("DELETE FROM trade_outcomes WHERE rowid=?", (trade_id,))
            conn_rw.commit()
        except Exception as e:
            conn_rw.close()
            print(json.dumps({"error": str(e)}))
            return
        conn_rw.close()
        # Attempt ChromaDB cleanup
        try:
            import chromadb
            client = chromadb.PersistentClient(path=os.path.join(trevor_dir, "vectordb"))
            for col_name in ["trade-learnings", "trade_patterns"]:
                try:
                    col = client.get_collection(col_name)
                    results = col.get(where={"trade_id": str(trade_id)})
                    if results and results["ids"]:
                        col.delete(ids=results["ids"])
                except Exception:
                    pass
        except Exception:
            pass
        print(json.dumps({"ok": True, "deleted": trade_id, "ticker": ticker}))

    elif scope == "bulk_update":
        ids_json = sys.argv[2] if len(sys.argv) > 2 else "[]"
        status = sys.argv[3] if len(sys.argv) > 3 else "REVIEWED"
        ids = json.loads(ids_json)
        if not ids:
            conn.close()
            print(json.dumps({"error": "No ids provided"}))
            return
        conn.close()
        conn_rw = sqlite3.connect(db_path)
        try:
            placeholders = ",".join("?" for _ in ids)
            conn_rw.execute(
                f"UPDATE trade_outcomes SET training_status=? WHERE rowid IN ({placeholders})",
                [status] + [int(i) for i in ids]
            )
            conn_rw.commit()
            updated = conn_rw.total_changes
            print(json.dumps({"ok": True, "updated": updated}))
        except Exception as e:
            print(json.dumps({"error": str(e)}))
        finally:
            conn_rw.close()

    else:
        conn.close()
        print(json.dumps({"error": f"Unknown scope: {scope}"}))

if __name__ == "__main__":
    main()
