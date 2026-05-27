#!/usr/bin/env python3
"""
Hub Redesign feature flag reader.

Reads all HUB_REDESIGN_* rows from auto_config in trevor.db (read-only) and
emits a JSON object on stdout for /api/feature-flags consumption.

Output shape:
  {"flags": {"HUB_REDESIGN_AUTO": {"value": false, "updated_at": "..."}, ...}}

On any error: emits {"flags": {}, "error": "<msg>"} on stderr + exit 1.
"""
import json
import sqlite3
import sys

DB = "/home/trevor/trevor/trevor.db"


def main():
    try:
        with sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10) as conn:
            rows = conn.execute(
                "SELECT key, value, updated_at FROM auto_config "
                "WHERE key LIKE 'HUB_REDESIGN%' ORDER BY key"
            ).fetchall()
        flags = {
            row[0]: {
                "value": row[1] == "true",
                "updated_at": row[2],
            }
            for row in rows
        }
        print(json.dumps({"flags": flags}))
    except Exception as exc:
        print(json.dumps({"flags": {}, "error": str(exc)}), file=sys.stderr)
        sys.exit(1)


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
