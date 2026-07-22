#!/usr/bin/env python3
"""query_memory_liveness.py — TRAINER page · R11 memory liveness LINE backend (R12-B1 · decision 7).

Backs GET /api/trainer/memory-liveness — the ONE glance line at the top of the
TRAINER page: `memory: N entries · tiers H/W/C`. A LINE, not an alarm. Reads the
WSL-local R11 store (`memory.db`):
  entries = trainer_memory + watcher_memory row counts (the append-only knowledge
            tables — NOTHING is ever deleted, so this only grows).
  tiers   = memory_tier_state grouped by current_tier (HOT→H / WARM→W / COLD→C,
            bucketed on the first letter so it's robust whether current_tier
            stores "HOT" or "HOT_DETAIL").

The full memory-query UI is DEFERRED — this is the liveness line only.

READ-ONLY (`mode=ro`). Never writes the DB, never imports `hyperliquid`, never
imports `lib.memory_db` (a reader must not lazily build the store). Path
resolution mirrors lib/memory_db.resolve_db_path (MEMORY_DB_PATH env override,
else <repo>/data/memory.db recomputed from THIS file's location).

🚨 PRE-CUTOVER EMPTY IS THE DISPLAY, NOT AN ERROR. 0-row store → entries 0 /
tiers H0/W0/C0, and any missing table / missing file / read error returns that
empty shape with `exit(0)` — the line reads `memory: 0 entries · tiers H0/W0/C0`,
never a red error, never a 500.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from typing import Any, Optional

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB = os.environ.get("MEMORY_DB_PATH") or os.path.join(_SCRIPT_DIR, "data", "memory.db")


def _empty(error: Optional[str] = None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "status": "no_data_yet",
        "entries": 0,
        "tiers": {"H": 0, "W": 0, "C": 0},
    }
    if error is not None:
        out["error"] = error
    return out


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).fetchone()
        is not None
    )


def _count(conn: sqlite3.Connection, table: str) -> int:
    if not _table_exists(conn, table):
        return 0
    try:
        return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
    except sqlite3.OperationalError:
        return 0


def _tier_counts(conn: sqlite3.Connection) -> dict[str, int]:
    tiers = {"H": 0, "W": 0, "C": 0}
    if not _table_exists(conn, "memory_tier_state"):
        return tiers
    try:
        rows = conn.execute(
            "SELECT current_tier, COUNT(*) AS n FROM memory_tier_state GROUP BY current_tier"
        ).fetchall()
    except sqlite3.OperationalError:
        return tiers
    for r in rows:
        raw = (r["current_tier"] or "").strip().upper()
        bucket = raw[:1] if raw else ""
        if bucket in tiers:
            tiers[bucket] += int(r["n"] or 0)
    return tiers


def main() -> int:
    try:
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=8.0)
        conn.row_factory = sqlite3.Row
    except Exception as exc:
        print(json.dumps(_empty(f"{type(exc).__name__}: {exc}")))
        return 0

    try:
        entries = _count(conn, "trainer_memory") + _count(conn, "watcher_memory")
        tiers = _tier_counts(conn)
    except sqlite3.OperationalError as exc:
        conn.close()
        print(json.dumps(_empty(f"{type(exc).__name__}: {exc}")))
        return 0
    except Exception as exc:
        conn.close()
        print(json.dumps(_empty(f"{type(exc).__name__}: {exc}")))
        return 0
    conn.close()

    print(json.dumps({
        "status": "ok" if entries > 0 else "no_data_yet",
        "entries": entries,
        "tiers": tiers,
    }))
    return 0


if __name__ == "__main__":
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
