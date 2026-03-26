#!/usr/bin/env python3
"""Reminders query helper — called by Hub API routes via child_process."""
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "list"
    db_path = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # Ensure table exists
    conn.execute("""
        CREATE TABLE IF NOT EXISTS reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            due_at TEXT NOT NULL,
            repeat_mode TEXT NOT NULL DEFAULT 'once',
            times_fired INTEGER NOT NULL DEFAULT 0,
            last_fired_at TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            discord_message_id TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            completed_at TEXT,
            source TEXT NOT NULL DEFAULT 'discord'
        )
    """)
    conn.commit()

    if action == "list":
        include_all = len(sys.argv) > 2 and sys.argv[2] == "all"
        if include_all:
            rows = conn.execute("SELECT * FROM reminders ORDER BY due_at ASC").fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM reminders WHERE status IN ('pending', 'active') ORDER BY due_at ASC"
            ).fetchall()
        print(json.dumps({"reminders": [dict(r) for r in rows]}))

    elif action == "add":
        data = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
        text = data.get("text", "")
        due_at = data.get("due_at", "")
        repeat_mode = data.get("repeat_mode", "once")
        if not text or not due_at:
            print(json.dumps({"error": "text and due_at required"}))
            conn.close()
            return
        if repeat_mode not in ("once", "twice", "until_confirmed"):
            repeat_mode = "once"
        cur = conn.execute(
            "INSERT INTO reminders (text, due_at, repeat_mode, source) VALUES (?, ?, ?, 'hub')",
            (text, due_at, repeat_mode),
        )
        conn.commit()
        print(json.dumps({"id": cur.lastrowid, "status": "created"}))

    elif action == "update":
        data = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
        rid = data.get("id")
        if not rid:
            print(json.dumps({"error": "id required"}))
            conn.close()
            return
        sets, params = [], []
        for k in ("text", "due_at", "repeat_mode"):
            if k in data and data[k] is not None:
                sets.append(f"{k} = ?")
                params.append(data[k])
        if not sets:
            print(json.dumps({"error": "nothing to update"}))
            conn.close()
            return
        params.append(rid)
        conn.execute(f"UPDATE reminders SET {', '.join(sets)} WHERE id = ? AND status IN ('pending','active')", params)
        conn.commit()
        print(json.dumps({"ok": True}))

    elif action == "complete":
        rid = sys.argv[2] if len(sys.argv) > 2 else None
        if not rid:
            print(json.dumps({"error": "id required"}))
            conn.close()
            return
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        conn.execute("UPDATE reminders SET status='completed', completed_at=? WHERE id=?", (now, rid))
        conn.commit()
        print(json.dumps({"ok": True}))

    elif action == "cancel":
        rid = sys.argv[2] if len(sys.argv) > 2 else None
        if not rid:
            print(json.dumps({"error": "id required"}))
            conn.close()
            return
        conn.execute("UPDATE reminders SET status='cancelled' WHERE id=?", (rid,))
        conn.commit()
        print(json.dumps({"ok": True}))

    elif action == "delete":
        rid = sys.argv[2] if len(sys.argv) > 2 else None
        if not rid:
            print(json.dumps({"error": "id required"}))
            conn.close()
            return
        row = conn.execute("SELECT times_fired FROM reminders WHERE id=?", (rid,)).fetchone()
        if row and row["times_fired"] > 0:
            print(json.dumps({"error": "Already fired — use cancel instead"}))
            conn.close()
            return
        conn.execute("DELETE FROM reminders WHERE id=?", (rid,))
        conn.commit()
        print(json.dumps({"ok": True}))

    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))

    conn.close()


if __name__ == "__main__":
    main()
