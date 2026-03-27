#!/usr/bin/env python3
"""Training data query helper for Mission Control dashboard. READ ONLY."""
import sqlite3, json, sys, os

def main():
    scope = sys.argv[1] if len(sys.argv) > 1 else "summary"
    db_path = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")
    trevor_dir = os.environ.get("TREVOR_PROJECT_DIR", "/home/trevor/trevor")

    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)

    if scope == "summary":
        result = {}

        # Table counts
        table_counts = []
        for tbl in ["training_trades", "training_observations", "training_sentiment",
                     "training_annotations", "training_correlations", "training_funding_rates", "training_metadata"]:
            try:
                cnt = conn.execute(f"SELECT COUNT(*) FROM [{tbl}]").fetchone()[0]
                if cnt > 0:
                    table_counts.append({"table": tbl, "count": cnt})
            except:
                pass
        result["byTable"] = table_counts
        result["totalRecords"] = sum(t["count"] for t in table_counts)

        # Win/Loss/Scratch
        try:
            rows = conn.execute("SELECT outcome_result, COUNT(*) FROM training_trades GROUP BY outcome_result ORDER BY COUNT(*) DESC").fetchall()
            result["outcomes"] = {r[0]: r[1] for r in rows}
            wins = result["outcomes"].get("WIN", 0)
            losses = result["outcomes"].get("LOSS", 0)
            decided = wins + losses
            result["winRate"] = round((wins / decided) * 100) if decided > 0 else 0
        except:
            result["outcomes"] = {}
            result["winRate"] = 0

        # Avg confidence
        try:
            avg = conn.execute("SELECT AVG(confidence) FROM training_trades").fetchone()[0]
            result["avgConfidence"] = round(float(avg) * 100) if avg and avg <= 1 else round(float(avg or 0))
        except:
            result["avgConfidence"] = 0

        # Source breakdown
        try:
            rows = conn.execute("SELECT source, COUNT(*), SUM(CASE WHEN outcome_result='WIN' THEN 1 ELSE 0 END), SUM(CASE WHEN outcome_result='LOSS' THEN 1 ELSE 0 END) FROM training_trades GROUP BY source").fetchall()
            result["bySource"] = [{"source": r[0] or "unknown", "count": r[1], "wins": int(r[2] or 0), "losses": int(r[3] or 0)} for r in rows]
        except:
            result["bySource"] = []

        # Top tickers
        try:
            rows = conn.execute("SELECT ticker, COUNT(*), SUM(CASE WHEN outcome_result='WIN' THEN 1 ELSE 0 END), SUM(CASE WHEN outcome_result='LOSS' THEN 1 ELSE 0 END) FROM training_trades GROUP BY ticker ORDER BY COUNT(*) DESC LIMIT 20").fetchall()
            tickers = []
            for r in rows:
                c, w, l = r[1], int(r[2] or 0), int(r[3] or 0)
                tickers.append({"ticker": r[0], "count": c, "wins": w, "losses": l, "winRate": round((w / (w + l)) * 100) if (w + l) > 0 else 0})
            result["topTickers"] = tickers
        except:
            result["topTickers"] = []

        # Signal type breakdown
        try:
            rows = conn.execute("SELECT signal_type, COUNT(*), SUM(CASE WHEN outcome_result='WIN' THEN 1 ELSE 0 END), SUM(CASE WHEN outcome_result='LOSS' THEN 1 ELSE 0 END) FROM training_trades GROUP BY signal_type ORDER BY COUNT(*) DESC LIMIT 15").fetchall()
            strats = []
            for r in rows:
                c, w, l = r[1], int(r[2] or 0), int(r[3] or 0)
                strats.append({"strategy": r[0], "count": c, "wins": w, "losses": l, "winRate": round((w / (w + l)) * 100) if (w + l) > 0 else 0})
            result["strategyBreakdown"] = strats
        except:
            result["strategyBreakdown"] = []

        # Timeframes
        try:
            rows = conn.execute("SELECT timeframe, COUNT(*) FROM training_trades GROUP BY timeframe ORDER BY COUNT(*) DESC").fetchall()
            result["timeframes"] = [{"timeframe": r[0], "count": r[1]} for r in rows]
        except:
            result["timeframes"] = []

        # Date range
        try:
            row = conn.execute("SELECT MIN(date), MAX(date) FROM training_trades").fetchone()
            result["dateRange"] = {"earliest": row[0], "latest": row[1]}
        except:
            result["dateRange"] = {"earliest": None, "latest": None}

        # Metadata
        try:
            rows = conn.execute("SELECT key, value FROM training_metadata").fetchall()
            result["metadata"] = {r[0]: r[1] for r in rows}
        except:
            result["metadata"] = {}

        # Distinct tickers
        try:
            cnt = conn.execute("SELECT COUNT(DISTINCT ticker) FROM training_trades").fetchone()[0]
            result["distinctTickers"] = cnt
        except:
            result["distinctTickers"] = 0

        # By direction
        try:
            rows = conn.execute("SELECT direction, COUNT(*) as ct, SUM(CASE WHEN outcome_result='WIN' THEN 1 ELSE 0 END) as wins FROM training_trades GROUP BY direction").fetchall()
            result["byDirection"] = [{"direction": r[0] or "UNKNOWN", "count": r[1], "wins": int(r[2] or 0), "winRate": round(int(r[2] or 0)*100.0/r[1], 1) if r[1] > 0 else 0} for r in rows]
        except:
            result["byDirection"] = []

        # By regime
        try:
            rows = conn.execute("SELECT regime_trend, COUNT(*) as ct, SUM(CASE WHEN outcome_result='WIN' THEN 1 ELSE 0 END) as wins FROM training_trades WHERE regime_trend IS NOT NULL AND regime_trend != '' GROUP BY regime_trend ORDER BY ct DESC LIMIT 10").fetchall()
            result["byRegime"] = [{"regime": r[0], "count": r[1], "wins": int(r[2] or 0), "winRate": round(int(r[2] or 0)*100.0/r[1], 1) if r[1] > 0 else 0} for r in rows]
        except:
            result["byRegime"] = []

        conn.close()

        # ChromaDB
        try:
            sys.path.insert(0, trevor_dir)
            import chromadb
            client = chromadb.PersistentClient(path=os.path.join(trevor_dir, "vectordb"))
            collections = client.list_collections()
            chroma_cols = []
            chroma_total = 0
            for col in collections:
                if "training" in col.name:
                    cnt = col.count()
                    chroma_cols.append({"name": col.name, "trainingDocs": cnt})
                    chroma_total += cnt
            result["chromaStats"] = {"collections": chroma_cols, "totalDocuments": chroma_total}
        except Exception as e:
            result["chromaStats"] = {"collections": [], "totalDocuments": 0, "error": str(e)}

        # Rollback
        result["rollbackAvailable"] = os.path.exists(os.path.join(trevor_dir, "training_bridge.py"))

        print(json.dumps(result))

    elif scope == "records":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 50
        offset = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        # Filters passed as JSON in argv[4]
        filters = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}

        conditions = ["1=1"]
        if filters.get("ticker"):
            conditions.append(f"ticker='{filters['ticker']}'")
        if filters.get("outcome"):
            conditions.append(f"outcome_result='{filters['outcome']}'")
        if filters.get("signal_type"):
            conditions.append(f"signal_type='{filters['signal_type']}'")
        if filters.get("timeframe"):
            conditions.append(f"timeframe='{filters['timeframe']}'")
        if filters.get("search"):
            s = filters["search"].replace("'", "''")
            conditions.append(f"(ticker LIKE '%{s}%' OR lesson LIKE '%{s}%' OR signal_type LIKE '%{s}%')")

        where = " AND ".join(conditions)

        total = conn.execute(f"SELECT COUNT(*) FROM training_trades WHERE {where}").fetchone()[0]
        rows = conn.execute(f"""SELECT id, ticker, signal_type, direction, timeframe, date,
            entry, stop, target, rr_ratio, confidence, outcome_result, pnl_pct, lesson, source
            FROM training_trades WHERE {where} ORDER BY id DESC LIMIT {limit} OFFSET {offset}""").fetchall()

        records = []
        for r in rows:
            conf = r[10]
            if conf is not None:
                conf = round(float(conf) * 100) if float(conf) <= 1 else int(conf)
            records.append({
                "id": r[0], "ticker": r[1], "signal_type": r[2], "direction": r[3],
                "timeframe": r[4], "date": r[5], "entry": r[6], "stop": r[7], "target": r[8],
                "rr_ratio": r[9], "confidence": conf,
                "outcome": r[11], "pnl_pct": r[12], "lesson": r[13], "source": r[14]
            })

        conn.close()
        print(json.dumps({"records": records, "total": total}))

    elif scope == "chroma":
        query = sys.argv[2] if len(sys.argv) > 2 else ""
        collection_name = sys.argv[3] if len(sys.argv) > 3 else "training_knowledge"
        conn.close()

        if not query:
            print(json.dumps({"results": [], "message": "No query provided"}))
            return

        try:
            sys.path.insert(0, trevor_dir)
            import chromadb
            client = chromadb.PersistentClient(path=os.path.join(trevor_dir, "vectordb"))
            col = client.get_collection(collection_name)
            results = col.query(
                query_texts=[query],
                n_results=10,
                where={"source": {"$eq": "synthetic_training"}}
            )
            out = []
            for i, doc in enumerate(results["documents"][0]):
                meta = results["metadatas"][0][i] if results["metadatas"] else {}
                dist = results["distances"][0][i] if results["distances"] else 0
                out.append({
                    "document": doc[:500],
                    "metadata": meta,
                    "distance": dist,
                    "id": results["ids"][0][i]
                })
            print(json.dumps({"results": out, "collection": collection_name}))
        except Exception as e:
            print(json.dumps({"results": [], "error": str(e)}))
    else:
        print(json.dumps({"error": f"Unknown scope: {scope}"}))

if __name__ == "__main__":
    main()
