#!/usr/bin/env python3
"""Brain/XP/Cost query helper for Mission Control dashboard. READ ONLY."""
import sqlite3, json, sys, os

RANK_THRESHOLDS = [
    (0,      "Intern Quant",       1),
    (500,    "Junior Analyst",     2),
    (1500,   "Desk Analyst",       3),
    (3500,   "Senior Analyst",     4),
    (7000,   "Lead Strategist",    5),
    (12000,  "Risk Officer",       6),
    (20000,  "Portfolio Manager",  7),
    (32000,  "Head of Alpha",      8),
    (50000,  "Quant Director",     9),
    (75000,  "Chief Analyst",      10),
    (110000, "Managing Director",  11),
    (160000, "Partner",            12),
    (220000, "CIO",                13),
    (300000, "Co-Founder",         14),
    (400000, "CEO",                15),
]

def rank_for_xp(xp):
    current = RANK_THRESHOLDS[0]
    for threshold in RANK_THRESHOLDS:
        if xp >= threshold[0]:
            current = threshold
        else:
            break
    return current

def main():
    scope = sys.argv[1] if len(sys.argv) > 1 else "xp"
    db_path = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")
    trevor_dir = os.environ.get("TREVOR_PROJECT_DIR", "/home/trevor/trevor")

    if scope == "xp":
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        result = {"currentXP": 0, "currentRank": "Intern Quant", "totalXP": 0, "history": []}

        try:
            total = conn.execute("SELECT COALESCE(SUM(amount), 0) FROM xp_ledger").fetchone()[0]
            result["totalXP"] = int(total or 0)
            result["currentXP"] = result["totalXP"]
        except Exception:
            pass

        try:
            rows = conn.execute("SELECT amount, reason, event_type, total_after, created_at FROM xp_ledger ORDER BY id DESC LIMIT 30").fetchall()
            result["history"] = [dict(r) for r in rows]
        except Exception:
            pass

        rank_info = rank_for_xp(result["totalXP"])
        result["currentRank"] = rank_info[1]
        result["rankNumber"] = rank_info[2]

        next_idx = RANK_THRESHOLDS.index(rank_info) + 1
        if next_idx < len(RANK_THRESHOLDS):
            next_rank = RANK_THRESHOLDS[next_idx]
            result["nextRank"] = next_rank[1]
            result["nextRankXP"] = next_rank[0]
            result["xpToNext"] = next_rank[0] - result["totalXP"]

        result["ranks"] = [{"name": r[1], "xp": r[0], "number": r[2]} for r in RANK_THRESHOLDS]
        conn.close()
        print(json.dumps(result))

    elif scope == "brain":
        result = {"files": {}}
        brain_dir = os.path.join(trevor_dir, "brain")
        brain_files = ["IDENTITY", "BRAIN", "SOUL", "AGENTS", "MEMORY", "HEARTBEAT"]
        for name in brain_files:
            found = False
            for candidate in [os.path.join(brain_dir, name), os.path.join(brain_dir, f"{name}.md"),
                              os.path.join(brain_dir, name.lower()), os.path.join(brain_dir, f"{name.lower()}.md")]:
                if os.path.exists(candidate):
                    try:
                        with open(candidate, "r", encoding="utf-8") as f:
                            content = f.read()
                        result["files"][name] = {"content": content[:5000], "size": len(content), "path": candidate, "modified": os.path.getmtime(candidate)}
                    except Exception as e:
                        result["files"][name] = {"content": f"Error: {e}", "size": 0, "path": candidate}
                    found = True
                    break
            if not found:
                result["files"][name] = {"content": "", "size": 0, "path": "", "missing": True}
        print(json.dumps(result))

    elif scope == "vectors":
        result = {"collections": [], "totalDocuments": 0}
        try:
            sys.path.insert(0, trevor_dir)
            import chromadb
            client = chromadb.PersistentClient(path=os.path.join(trevor_dir, "vectordb"))
            for col in client.list_collections():
                cnt = col.count()
                result["totalDocuments"] += cnt
                result["collections"].append({"name": col.name, "count": cnt})
        except Exception as e:
            result["error"] = str(e)
        print(json.dumps(result))

    elif scope == "costs":
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        result = {"daily": [], "totalSpend": 0, "byType": []}
        try:
            rows = conn.execute("SELECT date, SUM(cost_usd) as daily_cost, COUNT(*) as calls FROM cost_tracking WHERE date >= date('now', '-30 days') GROUP BY date ORDER BY date ASC").fetchall()
            result["daily"] = [{"date": r["date"], "cost": round(float(r["daily_cost"] or 0), 4), "calls": r["calls"]} for r in rows]
        except Exception:
            pass
        try:
            total = conn.execute("SELECT COALESCE(SUM(cost_usd), 0) FROM cost_tracking").fetchone()[0]
            result["totalSpend"] = round(float(total or 0), 4)
        except Exception:
            pass
        try:
            rows = conn.execute("SELECT call_type, SUM(cost_usd) as total, COUNT(*) as calls FROM cost_tracking GROUP BY call_type ORDER BY total DESC").fetchall()
            result["byType"] = [{"type": r["call_type"], "cost": round(float(r["total"] or 0), 4), "calls": r["calls"]} for r in rows]
        except Exception:
            pass
        conn.close()
        print(json.dumps(result))
    else:
        print(json.dumps({"error": f"Unknown scope: {scope}"}))

if __name__ == "__main__":
    main()
