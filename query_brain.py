#!/usr/bin/env python3
"""Brain/Cost query helper for Mission Control dashboard. READ ONLY."""
import sqlite3, json, sys, os, glob

def main():
    scope = sys.argv[1] if len(sys.argv) > 1 else "brain"
    db_path = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")
    trevor_dir = os.environ.get("TREVOR_PROJECT_DIR", "/home/trevor/trevor")

    if scope == "brain":
        result = {"files": {}}
        brain_dir = os.path.join(trevor_dir, "brain")
        brain_files = ["IDENTITY", "BRAIN", "SOUL", "AGENTS", "MEMORY", "HEARTBEAT"]

        for name in brain_files:
            path = os.path.join(brain_dir, name)
            # Try with .md extension too
            if not os.path.exists(path):
                path = os.path.join(brain_dir, f"{name}.md")
            if not os.path.exists(path):
                path = os.path.join(brain_dir, name.lower())
            if not os.path.exists(path):
                path = os.path.join(brain_dir, f"{name.lower()}.md")

            if os.path.exists(path):
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        content = f.read()
                    result["files"][name] = {
                        "content": content[:5000],
                        "size": len(content),
                        "path": path,
                        "modified": os.path.getmtime(path),
                    }
                except Exception as e:
                    result["files"][name] = {"content": f"Error: {e}", "size": 0, "path": path}
            else:
                result["files"][name] = {"content": "", "size": 0, "path": "", "missing": True}

        print(json.dumps(result))

    elif scope == "vectors":
        result = {"collections": [], "totalDocuments": 0}
        try:
            sys.path.insert(0, trevor_dir)
            import chromadb
            client = chromadb.PersistentClient(path=os.path.join(trevor_dir, "vectordb"))
            collections = client.list_collections()
            total = 0
            for col in collections:
                cnt = col.count()
                total += cnt
                result["collections"].append({"name": col.name, "count": cnt})
            result["totalDocuments"] = total
        except Exception as e:
            result["error"] = str(e)
        print(json.dumps(result))

    elif scope == "costs":
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=10)
        conn.row_factory = sqlite3.Row
        result = {"daily": [], "totalSpend": 0, "byModel": []}

        # Daily costs (last 30 days)
        try:
            rows = conn.execute("""
                SELECT date(timestamp) as day, SUM(cost) as daily_cost, COUNT(*) as calls
                FROM cost_tracking
                WHERE timestamp >= datetime('now', '-30 days')
                GROUP BY date(timestamp)
                ORDER BY day ASC
            """).fetchall()
            result["daily"] = [dict(r) for r in rows]
        except Exception:
            pass

        # Total spend
        try:
            total = conn.execute("SELECT SUM(cost) FROM cost_tracking").fetchone()[0]
            result["totalSpend"] = round(float(total or 0), 4)
        except Exception:
            pass

        # By model
        try:
            rows = conn.execute("""
                SELECT model, SUM(cost) as total, COUNT(*) as calls
                FROM cost_tracking
                GROUP BY model ORDER BY total DESC
            """).fetchall()
            result["byModel"] = [dict(r) for r in rows]
        except Exception:
            pass

        conn.close()
        print(json.dumps(result))

    else:
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
