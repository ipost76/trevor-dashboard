#!/usr/bin/env python3
"""
query_scout_v3_flag.py — read SCOUT_V3_FEED from TREVOR's auto_config.

Invoked via runPython by the server component that gates DiscoveryFeed (v2)
vs DiscoveryFeedV3.

Output: JSON to stdout, exit 0 on success.
  {"enabled": false}
or
  {"enabled": true, "updated_at": "2026-05-13 18:00:00"}

Read-only. No writes. Fail-safe to {"enabled": false} on any error.
"""
import json
import sqlite3
import sys

DB_PATH = "/home/trevor/trevor/trevor.db"


def main() -> int:
    try:
        conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=5)
        row = conn.execute(
            "SELECT value, updated_at FROM auto_config WHERE key = ?",
            ("SCOUT_V3_FEED",),
        ).fetchone()
        conn.close()

        if not row:
            print(json.dumps({"enabled": False, "reason": "key_missing"}))
            return 0

        value, updated_at = row
        enabled = str(value).strip().lower() in {"true", "1", "yes", "on"}
        print(json.dumps({"enabled": enabled, "updated_at": updated_at}))
        return 0
    except Exception as e:
        # Fail safe — closed
        print(json.dumps({"enabled": False, "error": type(e).__name__}))
        return 0


if __name__ == "__main__":
    # OUTER-WRAP: 2026-05-27 (silent-crash visibility)
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        sys.exit(main())

    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
