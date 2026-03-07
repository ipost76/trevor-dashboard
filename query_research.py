#!/usr/bin/env python3
"""Research data query helper for Mission Control dashboard. READ ONLY."""
import sqlite3, json, sys, os

def main():
    scope = sys.argv[1] if len(sys.argv) > 1 else "analyses"
    db_path = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")
    trevor_dir = os.environ.get("TREVOR_PROJECT_DIR", "/home/trevor/trevor")

    if scope == "analyses":
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row

        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 50
        offset = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        filters = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}

        conditions = ["1=1"]
        if filters.get("ticker"):
            conditions.append(f"ticker='{filters['ticker']}'")
        if filters.get("type"):
            conditions.append(f"analysis_type='{filters['type']}'")
        if filters.get("search"):
            s = filters["search"].replace("'", "''")
            conditions.append(f"(ticker LIKE '%{s}%' OR summary LIKE '%{s}%' OR analysis_type LIKE '%{s}%')")

        where = " AND ".join(conditions)

        try:
            total = conn.execute(f"SELECT COUNT(*) FROM swarm_analyses WHERE {where}").fetchone()[0]
            rows = conn.execute(f"""
                SELECT id, ticker, analysis_type, summary, full_analysis, confidence,
                       timestamp, model_used, cost
                FROM swarm_analyses WHERE {where}
                ORDER BY timestamp DESC LIMIT {limit} OFFSET {offset}
            """).fetchall()
            records = []
            for r in rows:
                d = dict(r)
                # Truncate full_analysis for listing
                if d.get("full_analysis") and len(d["full_analysis"]) > 500:
                    d["full_analysis_preview"] = d["full_analysis"][:500] + "..."
                else:
                    d["full_analysis_preview"] = d.get("full_analysis", "")
                records.append(d)
        except Exception as e:
            total = 0
            records = []

        conn.close()
        print(json.dumps({"records": records, "total": total}))

    elif scope == "insights":
        query = sys.argv[2] if len(sys.argv) > 2 else ""
        collection = sys.argv[3] if len(sys.argv) > 3 else "market_insights"

        if not query:
            print(json.dumps({"results": [], "message": "No query provided"}))
            return

        try:
            sys.path.insert(0, trevor_dir)
            import chromadb
            client = chromadb.PersistentClient(path=os.path.join(trevor_dir, "vectordb"))
            col = client.get_collection(collection)
            results = col.query(query_texts=[query], n_results=10)
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
            print(json.dumps({"results": out, "collection": collection}))
        except Exception as e:
            print(json.dumps({"results": [], "error": str(e)}))

    elif scope == "quick":
        ticker = sys.argv[2] if len(sys.argv) > 2 else "BTC"

        try:
            sys.path.insert(0, trevor_dir)
            from market_data import MarketDataFetcher
            mdf = MarketDataFetcher()

            # Try to get data and calculate indicators
            indicators = mdf.calculate_indicators(ticker)
            if indicators:
                # Convert any non-serializable values
                clean = {}
                for k, v in indicators.items():
                    if v is None:
                        clean[k] = None
                    elif isinstance(v, (int, float)):
                        clean[k] = round(float(v), 4) if isinstance(v, float) else v
                    elif isinstance(v, dict):
                        clean[k] = {kk: round(float(vv), 4) if isinstance(vv, float) else vv for kk, vv in v.items()}
                    else:
                        clean[k] = str(v)
                print(json.dumps({"ticker": ticker, "indicators": clean}))
            else:
                print(json.dumps({"ticker": ticker, "indicators": {}, "error": "No data returned"}))
        except Exception as e:
            print(json.dumps({"ticker": ticker, "indicators": {}, "error": str(e)}))

    else:
        print(json.dumps({"error": f"Unknown scope: {scope}"}))

if __name__ == "__main__":
    main()
