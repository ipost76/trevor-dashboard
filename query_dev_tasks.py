#!/usr/bin/env python3
"""Dev tasks query helper for Mission Control dashboard."""
import sqlite3, json, sys, os


def main():
    scope = sys.argv[1] if len(sys.argv) > 1 else "list"
    trevor_dir = os.environ.get("TREVOR_PROJECT_DIR", "/home/trevor/trevor")
    db_path = os.environ.get("TREVOR_DB_PATH", os.path.join(trevor_dir, "trevor.db"))

    if scope == "list":
        status = sys.argv[2] if len(sys.argv) > 2 else ""
        category = sys.argv[3] if len(sys.argv) > 3 else ""
        priority = sys.argv[4] if len(sys.argv) > 4 else ""

        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row

        clauses = ["status != 'deleted'"]
        params = []
        if status:
            clauses.append("status = ?")
            params.append(status)
        if category:
            clauses.append("category = ?")
            params.append(category)
        if priority:
            clauses.append("priority = ?")
            params.append(priority)
        where = " AND ".join(clauses)

        rows = conn.execute(
            f"""SELECT id, title, notes, category, priority, status,
                       created_at, updated_at, completed_at
                FROM dev_tasks WHERE {where}
                ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'med' THEN 2 WHEN 'low' THEN 3 END,
                         created_at DESC""",
            params,
        ).fetchall()
        conn.close()

        tasks = [dict(r) for r in rows]
        # Counts
        conn2 = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        row = conn2.execute(
            "SELECT COUNT(*) as total, SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) as open_count, "
            "SUM(CASE WHEN status='in-progress' THEN 1 ELSE 0 END) as wip_count, "
            "SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done_count "
            "FROM dev_tasks WHERE status != 'deleted'"
        ).fetchone()
        conn2.close()
        counts = {"total": row[0] or 0, "open": row[1] or 0, "wip": row[2] or 0, "done": row[3] or 0}
        print(json.dumps({"tasks": tasks, "counts": counts}))

    elif scope == "toggle":
        task_id = int(sys.argv[2])
        new_status = sys.argv[3] if len(sys.argv) > 3 else "done"
        conn = sqlite3.connect(db_path)
        completed = None
        if new_status == "done":
            from datetime import datetime
            completed = datetime.utcnow().isoformat()
        conn.execute(
            "UPDATE dev_tasks SET status=?, completed_at=?, updated_at=datetime('now') WHERE id=?",
            (new_status, completed, task_id),
        )
        conn.commit()
        conn.close()
        print(json.dumps({"ok": True, "id": task_id, "status": new_status}))

    else:
        print(json.dumps({"error": f"Unknown scope: {scope}"}))


if __name__ == "__main__":
    main()
