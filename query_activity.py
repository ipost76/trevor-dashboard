#!/usr/bin/env python3
"""query_activity.py — D3 (Activity log) backend.

GET /api/auto/activity?limit=&offset=&actor=&source_type=&key=&table_name=

Returns paginated rows from the change_log cross-index (B1b). Supports
filters on actor, source_type, key, and table_name (all optional). Always
returns the most recent rows first.

Argv (positional; all optional):
    query_activity.py [limit] [offset] [actor] [source_type] [key] [table_name]

Use "*" or empty string as a filter wildcard.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from typing import Optional, Tuple

DB = "/home/trevor/trevor/trevor.db"

DEFAULT_LIMIT = 50
MAX_LIMIT = 500


def _arg(idx: int) -> Optional[str]:
    if idx >= len(sys.argv):
        return None
    v = sys.argv[idx]
    if v is None:
        return None
    v = v.strip()
    if v == "" or v == "*":
        return None
    return v


def main() -> int:
    try:
        limit = int(_arg(1) or str(DEFAULT_LIMIT))
    except ValueError:
        limit = DEFAULT_LIMIT
    limit = max(1, min(MAX_LIMIT, limit))

    try:
        offset = int(_arg(2) or "0")
    except ValueError:
        offset = 0
    offset = max(0, offset)

    actor = _arg(3)
    source_type = _arg(4)
    key_filter = _arg(5)
    table_name = _arg(6)

    where_clauses: list[str] = []
    params: list[object] = []
    if actor:
        where_clauses.append("actor = ?")
        params.append(actor)
    if source_type:
        where_clauses.append("source_type = ?")
        params.append(source_type)
    if key_filter:
        where_clauses.append("key = ?")
        params.append(key_filter)
    if table_name:
        where_clauses.append("table_name = ?")
        params.append(table_name)

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    try:
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=5.0)
        # PRAGMA table_info first so we degrade gracefully if change_log
        # doesn't exist yet (pre-B1b DBs).
        existing_cols = {
            row[1] for row in conn.execute("PRAGMA table_info(change_log)").fetchall()
        }
        if not existing_cols:
            print(json.dumps({
                "entries": [], "total": 0,
                "limit": limit, "offset": offset,
                "filters": {
                    "actor": actor, "source_type": source_type,
                    "key": key_filter, "table_name": table_name,
                },
                "error": "change_log table missing (B1b not deployed?)",
            }))
            return 0

        total = conn.execute(
            f"SELECT COUNT(*) FROM change_log {where_sql}", params
        ).fetchone()[0]

        rows = conn.execute(
            f"SELECT id, timestamp, table_name, row_id, key, "
            f"       old_value, new_value, actor, source_type, "
            f"       session_id, prompt_id, notes "
            f"FROM change_log {where_sql} "
            f"ORDER BY id DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()
        conn.close()
    except Exception as exc:
        print(json.dumps({
            "entries": [], "total": 0,
            "limit": limit, "offset": offset,
            "error": f"{type(exc).__name__}: {exc}",
        }))
        return 0

    entries = [
        {
            "id": r[0], "timestamp": r[1], "table_name": r[2],
            "row_id": r[3], "key": r[4],
            "old_value": r[5], "new_value": r[6],
            "actor": r[7], "source_type": r[8],
            "session_id": r[9], "prompt_id": r[10], "notes": r[11],
        }
        for r in rows
    ]

    print(json.dumps({
        "entries": entries,
        "total": total,
        "returned": len(entries),
        "limit": limit,
        "offset": offset,
        "filters": {
            "actor": actor,
            "source_type": source_type,
            "key": key_filter,
            "table_name": table_name,
        },
    }, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
