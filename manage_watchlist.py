#!/usr/bin/env python3
"""Watchlist management helper for Mission Control dashboard. READ-WRITE."""
import sqlite3, json, sys, os

def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "list"
    db_path = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")

    conn = sqlite3.connect(db_path, timeout=10)
    conn.row_factory = sqlite3.Row

    # Ensure table exists
    conn.execute("""
        CREATE TABLE IF NOT EXISTS watchlist (
            ticker TEXT NOT NULL,
            mode TEXT NOT NULL DEFAULT 'scalp',
            added_at TEXT DEFAULT (datetime('now')),
            notes TEXT DEFAULT '',
            PRIMARY KEY (ticker, mode)
        )
    """)

    if action == "add":
        ticker = sys.argv[2].upper() if len(sys.argv) > 2 else ""
        mode = sys.argv[3] if len(sys.argv) > 3 else "scalp"
        if not ticker:
            print(json.dumps({"error": "Ticker required"}))
            conn.close()
            return
        try:
            conn.execute(
                "INSERT OR IGNORE INTO watchlist (ticker, mode) VALUES (?, ?)",
                (ticker, mode)
            )
            conn.commit()
            print(json.dumps({"ok": True, "ticker": ticker, "mode": mode}))
        except Exception as e:
            print(json.dumps({"error": str(e)}))

    elif action == "remove":
        ticker = sys.argv[2].upper() if len(sys.argv) > 2 else ""
        mode = sys.argv[3] if len(sys.argv) > 3 else "scalp"
        if not ticker:
            print(json.dumps({"error": "Ticker required"}))
            conn.close()
            return
        try:
            conn.execute(
                "DELETE FROM watchlist WHERE ticker=? AND mode=?",
                (ticker, mode)
            )
            conn.commit()
            print(json.dumps({"ok": True, "removed": ticker, "mode": mode}))
        except Exception as e:
            print(json.dumps({"error": str(e)}))

    elif action == "list":
        try:
            rows = conn.execute("SELECT ticker, mode, added_at, notes FROM watchlist ORDER BY mode, ticker").fetchall()
            print(json.dumps({"items": [dict(r) for r in rows]}))
        except Exception as e:
            print(json.dumps({"items": [], "error": str(e)}))

    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))

    conn.close()

if __name__ == "__main__":
    main()
