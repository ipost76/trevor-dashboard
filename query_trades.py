#!/usr/bin/env python3
"""Trade data query helper for Mission Control dashboard."""
import sqlite3, json, sys, os

def main():
    scope = sys.argv[1] if len(sys.argv) > 1 else "active"
    trevor_dir = os.environ.get("TREVOR_PROJECT_DIR", "/home/trevor/trevor")
    db_path = os.environ.get("TREVOR_DB_PATH", os.path.join(trevor_dir, "trevor.db"))

    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=10)
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
                       profit_target_price, entry_groups, margin_usd,
                       original_entry_price, avg_entry_price, original_margin,
                       remaining_margin, total_margin, total_realized_pnl,
                       partials_count, additions_count
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

        # Parameterized WHERE build (QUAL-02): user-influenced values (ticker,
        # direction) bind via ? placeholders, never f-string interpolation.
        conditions = ["status = 'closed'"]
        params: list = []
        if filters.get("ticker"):
            conditions.append("ticker LIKE ?")
            params.append(f"%{filters['ticker']}%")  # wildcards live in the bound value
        if filters.get("outcome"):
            if filters["outcome"] == "WIN":
                conditions.append("pnl_pct > 0")
            elif filters["outcome"] == "LOSS":
                conditions.append("pnl_pct <= 0")
        if filters.get("direction"):
            conditions.append("direction = ?")
            params.append(filters["direction"])

        where = " AND ".join(conditions)

        try:
            total = conn.execute(
                "SELECT COUNT(*) FROM active_trades WHERE " + where, params
            ).fetchone()[0]
            rows = conn.execute(
                "SELECT id, trade_id, ticker, direction, entry_price, exit_price, pnl_pct, "
                "leverage, confidence, opened_at as created_at, closed_at, track "
                "FROM active_trades WHERE " + where + " "
                "ORDER BY closed_at DESC LIMIT ? OFFSET ?",
                params + [limit, offset],
            ).fetchall()
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
        conn_rw = sqlite3.connect(db_path, timeout=10)
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
        trade_id_arg = sys.argv[2] if len(sys.argv) > 2 else None
        if not trade_id_arg:
            conn.close()
            print(json.dumps({"error": "Missing trade id"}))
            return

        purged = {}

        # Find trade in active_trades by trade_id (string) or id (numeric)
        trade = conn.execute(
            "SELECT trade_id, ticker, direction, entry_price, exit_price, pnl_pct FROM active_trades WHERE trade_id=? AND status='closed'",
            (trade_id_arg,)
        ).fetchone()
        if not trade:
            try:
                trade = conn.execute(
                    "SELECT trade_id, ticker, direction, entry_price, exit_price, pnl_pct FROM active_trades WHERE id=? AND status='closed'",
                    (int(trade_id_arg),)
                ).fetchone()
            except (ValueError, TypeError):
                pass
        if not trade:
            conn.close()
            print(json.dumps({"error": "Trade not found", "trade_id": trade_id_arg}))
            return

        trade_id = trade["trade_id"]
        ticker = trade["ticker"]
        direction = trade["direction"]
        entry_price = trade["entry_price"]
        exit_price = trade["exit_price"]
        pnl_pct = trade["pnl_pct"]
        conn.close()

        # SQLite deletions (read-write)
        conn_rw = sqlite3.connect(db_path, timeout=10)
        try:
            cur = conn_rw.execute("DELETE FROM active_trades WHERE trade_id=? AND status='closed'", (trade_id,))
            purged["active_trades"] = cur.rowcount

            # Find matching trade_outcome (exact match first, then fuzzy)
            norm_ticker = ticker.replace('-PERP', '').replace('/USD', '').upper()
            to_id = None
            row = conn_rw.execute(
                "SELECT id FROM trade_outcomes WHERE ticker=? AND direction=? AND entry_price=? AND exit_price=? LIMIT 1",
                (ticker, direction, entry_price, exit_price)
            ).fetchone()
            if row:
                to_id = row[0]

            if to_id is None and entry_price is not None and exit_price is not None:
                row = conn_rw.execute(
                    """SELECT id FROM trade_outcomes
                       WHERE REPLACE(REPLACE(UPPER(ticker), '-PERP', ''), '/USD', '') = ?
                       AND UPPER(COALESCE(direction, '')) = UPPER(?)
                       AND (
                           (entry_price IS NOT NULL AND ABS(entry_price - ?) < 0.02
                            AND exit_price IS NOT NULL AND ABS(exit_price - ?) < 0.02)
                           OR
                           (open_price IS NOT NULL AND ABS(open_price - ?) < 0.02
                            AND close_price IS NOT NULL AND ABS(close_price - ?) < 0.02)
                       )
                       ORDER BY id DESC LIMIT 1""",
                    (norm_ticker, direction, entry_price, exit_price, entry_price, exit_price)
                ).fetchone()
                if row:
                    to_id = row[0]

            # Fallback 3: match by pnl_pct proximity (±1.0)
            if to_id is None and pnl_pct is not None:
                row = conn_rw.execute(
                    """SELECT id FROM trade_outcomes
                       WHERE REPLACE(REPLACE(UPPER(ticker), '-PERP', ''), '/USD', '') = ?
                       AND UPPER(COALESCE(direction, '')) = UPPER(?)
                       AND leveraged_pnl_pct IS NOT NULL
                       AND ABS(leveraged_pnl_pct - ?) < 1.0
                       ORDER BY id DESC LIMIT 1""",
                    (norm_ticker, direction, pnl_pct)
                ).fetchone()
                if row:
                    to_id = row[0]

            # Fallback 4: percentage-based price tolerance (5% of entry)
            if to_id is None and entry_price is not None and exit_price is not None and entry_price > 0:
                pct_tol = max(entry_price * 0.05, 0.02)
                row = conn_rw.execute(
                    """SELECT id FROM trade_outcomes
                       WHERE REPLACE(REPLACE(UPPER(ticker), '-PERP', ''), '/USD', '') = ?
                       AND UPPER(COALESCE(direction, '')) = UPPER(?)
                       AND (
                           (entry_price IS NOT NULL AND ABS(entry_price - ?) < ?
                            AND exit_price IS NOT NULL AND ABS(exit_price - ?) < ?)
                           OR
                           (open_price IS NOT NULL AND ABS(open_price - ?) < ?
                            AND close_price IS NOT NULL AND ABS(close_price - ?) < ?)
                       )
                       ORDER BY id DESC LIMIT 1""",
                    (norm_ticker, direction, entry_price, pct_tol, exit_price, pct_tol,
                     entry_price, pct_tol, exit_price, pct_tol)
                ).fetchone()
                if row:
                    to_id = row[0]

            if to_id is not None:
                cur = conn_rw.execute("DELETE FROM trade_outcomes WHERE id=?", (to_id,))
                purged["trade_outcomes"] = cur.rowcount
            else:
                purged["trade_outcomes"] = 0

            try:
                cur = conn_rw.execute("DELETE FROM training_learned_outcomes WHERE trade_id=?", (trade_id,))
                purged["training_learned_outcomes"] = cur.rowcount
            except Exception:
                purged["training_learned_outcomes"] = 0

            conn_rw.commit()
        except Exception as e:
            conn_rw.close()
            print(json.dumps({"error": str(e), "partial": purged}))
            return
        conn_rw.close()

        # ChromaDB cleanup — all relevant collections
        try:
            import chromadb
            client = chromadb.PersistentClient(path=os.path.join(trevor_dir, "vectordb"))

            # learned-outcomes: deterministic ID format
            try:
                col = client.get_collection("learned-outcomes")
                deleted = 0
                for prefix in ["learned-manual-", "learned-autotrader-"]:
                    try:
                        doc_id = f"{prefix}{trade_id}"
                        existing = col.get(ids=[doc_id])
                        if existing and existing["ids"]:
                            col.delete(ids=[doc_id])
                            deleted += 1
                    except Exception:
                        pass
                purged["learned-outcomes"] = deleted
            except Exception:
                purged["learned-outcomes"] = 0

            # trade-learnings: match by symbol + direction + pnl proximity
            try:
                col = client.get_collection("trade-learnings")
                results = col.get(where={"symbol": ticker}, limit=100)
                to_delete = []
                if results and results["ids"]:
                    for i, meta in enumerate(results.get("metadatas", [])):
                        if not meta:
                            continue
                        if meta.get("direction", "").upper() != (direction or "").upper():
                            continue
                        if pnl_pct is not None and meta.get("pnl_pct") is not None:
                            if abs(float(meta["pnl_pct"]) - float(pnl_pct)) < 1.0:
                                to_delete.append(results["ids"][i])
                if to_delete:
                    col.delete(ids=to_delete)
                purged["trade-learnings"] = len(to_delete)
            except Exception:
                purged["trade-learnings"] = 0

            # trade_patterns + trade_knowledge: match by ticker + direction
            for col_name in ["trade_patterns", "trade_knowledge"]:
                try:
                    col = client.get_collection(col_name)
                    results = col.get(where={"ticker": ticker}, limit=100)
                    to_delete = []
                    if results and results["ids"]:
                        for i, meta in enumerate(results.get("metadatas", [])):
                            if meta and meta.get("direction", "").upper() == (direction or "").upper():
                                if pnl_pct is not None and meta.get("pnl_pct") is not None:
                                    if abs(float(meta["pnl_pct"]) - float(pnl_pct)) < 1.0:
                                        to_delete.append(results["ids"][i])
                    if to_delete:
                        col.delete(ids=to_delete)
                    purged[col_name] = len(to_delete)
                except Exception:
                    purged[col_name] = 0
        except Exception:
            pass

        print(json.dumps({"ok": True, "deleted": trade_id, "ticker": ticker, "purged": purged}))

    elif scope == "bulk_update":
        ids_json = sys.argv[2] if len(sys.argv) > 2 else "[]"
        status = sys.argv[3] if len(sys.argv) > 3 else "REVIEWED"
        ids = json.loads(ids_json)
        if not ids:
            conn.close()
            print(json.dumps({"error": "No ids provided"}))
            return
        conn.close()
        conn_rw = sqlite3.connect(db_path, timeout=10)
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
    # OUTER-WRAP: 2026-05-27 (silent-crash visibility)
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        main()

    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
