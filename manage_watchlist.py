#!/usr/bin/env python3
"""Watchlist management helper for Mission Control dashboard. READ-WRITE.

Single flat watchlist — add / remove / list by ticker only (FOLLOW-UP-09).
The `watchlist` table lives in trevor.db and is owned by the bot; this helper
only adds, removes, and lists ticker rows.
"""
import sqlite3, json, sys, os


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "list"
    db_path = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")

    conn = sqlite3.connect(db_path, timeout=10)
    conn.row_factory = sqlite3.Row

    if action == "add":
        ticker = sys.argv[2].upper() if len(sys.argv) > 2 else ""
        if not ticker:
            print(json.dumps({"error": "Ticker required"}))
            conn.close()
            return
        try:
            conn.execute(
                "INSERT OR IGNORE INTO watchlist (ticker) VALUES (?)",
                (ticker,)
            )
            conn.commit()
            print(json.dumps({"ok": True, "ticker": ticker}))
        except Exception as e:
            print(json.dumps({"error": str(e)}))

    elif action == "remove":
        ticker = sys.argv[2].upper() if len(sys.argv) > 2 else ""
        if not ticker:
            print(json.dumps({"error": "Ticker required"}))
            conn.close()
            return
        try:
            conn.execute(
                "DELETE FROM watchlist WHERE ticker=?",
                (ticker,)
            )
            conn.commit()
            print(json.dumps({"ok": True, "removed": ticker}))
        except Exception as e:
            print(json.dumps({"error": str(e)}))

    elif action == "list":
        try:
            rows = conn.execute(
                "SELECT ticker, added_at, notes FROM watchlist ORDER BY ticker"
            ).fetchall()
            print(json.dumps({"items": [dict(r) for r in rows]}))
        except Exception as e:
            print(json.dumps({"items": [], "error": str(e)}))

    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))

    conn.close()


if __name__ == "__main__":
    main()
