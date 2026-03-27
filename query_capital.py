#!/usr/bin/env python3
"""Query/update trading capital in trevor_config table."""
import json
import os
import sqlite3
import sys

trevor_dir = os.environ.get("TREVOR_PROJECT_DIR", "/home/trevor/trevor")
db_path = os.environ.get("TREVOR_DB_PATH", os.path.join(trevor_dir, "trevor.db"))


def main():
    scope = sys.argv[1] if len(sys.argv) > 1 else "get"

    if scope == "get":
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        try:
            row = conn.execute("SELECT value FROM trevor_config WHERE key='trading_capital'").fetchone()
            capital = float(row["value"]) if row else 50.0
        except Exception:
            capital = 50.0
        conn.close()
        print(json.dumps({"capital": capital}))

    elif scope == "set":
        value = float(sys.argv[2]) if len(sys.argv) > 2 else 50.0
        conn = sqlite3.connect(db_path)
        conn.execute(
            "INSERT OR REPLACE INTO trevor_config (key, value, updated_at) VALUES ('trading_capital', ?, datetime('now'))",
            (str(value),),
        )
        conn.commit()
        conn.close()
        print(json.dumps({"capital": value, "updated": True}))

    else:
        print(json.dumps({"error": f"Unknown scope: {scope}"}))


if __name__ == "__main__":
    main()
