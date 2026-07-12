#!/usr/bin/env python3
"""query_promotion_ready.py — PROMOTIONS subtab backend (RM-SHADOW-PROMOTE B2).

GET /api/shadow/promotions returns the at-a-glance readiness list: the shadows
the nightly readiness gate (built C1, populated by B1's off-loop VM job) has
flagged. One row per shadow whose `promotion_ready.state` is 'ready' or
'in_progress'; 'removed' rows are filtered out of the active view (kept in the
DB as history — additive-DB law, no DROP).

Fields surfaced (a glanceable subset of the C1 schema — deep stats live on
/health, shadow inventory on the Shadow tab):
  shadow_name · description · state · n_distinct · expectancy_usd ·
  verdict_summary · first_ready_at
plus a top-level replica-freshness stamp (the WSL litestream replica refreshes
every ~15 min via trevor-restore.timer, so a glance knows the list may lag).

DECOUPLED + FAIL-SOFT: the table is EMPTY until B1's nightly gate populates it
(air-gapped off-loop job). This script NEVER 500s — a missing table, a missing
column, an old replica, or any read error returns an empty list, so the subtab
renders its "nothing ready yet" empty-state cleanly rather than erroring.

READ-ONLY (`mode=ro`). Never writes the DB, never imports `hyperliquid`. The Hub
displays only — all state transitions (ready/in_progress/removed) are B1's job.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Optional

DB = "/home/trevor/trevor/trevor.db"  # symlink → /home/ghost/trevor-replica/trevor.db on WSL

# Only the active view — 'removed' is history, kept in the DB but filtered here.
ACTIVE_STATES = ("ready", "in_progress")

# Glanceable columns the PromotionsList renders (confirmed against the C1 schema).
COLUMNS = (
    "shadow_name",
    "description",
    "state",
    "n_distinct",
    "expectancy_usd",
    "verdict_summary",
    "first_ready_at",
)


def _replica_age() -> tuple[Optional[int], Optional[str]]:
    """Replica freshness from the published-file mtime (atomic-mv restore stamp)."""
    try:
        target = os.path.realpath(DB)
        st = os.stat(target)
        age = int(datetime.now(timezone.utc).timestamp() - st.st_mtime)
        iso = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        return max(0, age), iso
    except Exception:
        return None, None


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).fetchone()
        is not None
    )


def _read_promotions(conn: sqlite3.Connection) -> list[dict]:
    """Active promotion-ready rows, ready-first then most-recently-flagged first.

    Fail-soft to [] if the table or a column is absent (old replica / pre-C1 /
    schema drift) — a missing readiness gate is an empty list, never an error.
    """
    if not _table_exists(conn, "promotion_ready"):
        return []
    cols = ", ".join(COLUMNS)
    # Parameter-bound IN over ACTIVE_STATES; ready sorts before in_progress, then
    # newest first_ready_at first (NULLs last).
    placeholders = ",".join("?" for _ in ACTIVE_STATES)
    sql = (
        f"SELECT {cols} FROM promotion_ready "
        f"WHERE state IN ({placeholders}) "
        f"ORDER BY CASE state WHEN 'ready' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, "
        f"first_ready_at IS NULL, first_ready_at DESC"
    )
    try:
        rows = conn.execute(sql, ACTIVE_STATES).fetchall()
    except sqlite3.OperationalError:
        # Column/table shape drift → empty active view, never a crash.
        return []
    out: list[dict] = []
    for r in rows:
        out.append(
            {
                "shadow_name": r["shadow_name"],
                "description": r["description"],
                "state": r["state"],
                "n_distinct": r["n_distinct"],
                "expectancy_usd": r["expectancy_usd"],
                "verdict_summary": r["verdict_summary"],
                "first_ready_at": r["first_ready_at"],
            }
        )
    return out


def main() -> int:
    age, mtime = _replica_age()
    try:
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=8.0)
        conn.row_factory = sqlite3.Row
    except Exception as exc:
        print(json.dumps({
            "promotions": [], "total": 0,
            "replica_age_seconds": age, "replica_mtime": mtime,
            "error": f"{type(exc).__name__}: {exc}",
        }))
        return 0

    try:
        promotions = _read_promotions(conn)
    except Exception as exc:
        conn.close()
        print(json.dumps({
            "promotions": [], "total": 0,
            "replica_age_seconds": age, "replica_mtime": mtime,
            "error": f"{type(exc).__name__}: {exc}",
        }))
        return 0
    conn.close()

    print(json.dumps({
        "promotions": promotions,
        "total": len(promotions),
        "replica_age_seconds": age,
        "replica_mtime": mtime,
    }, default=str))
    return 0


if __name__ == "__main__":
    # OUTER-WRAP: silent-crash visibility (mirrors query_shadow_registry.py).
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
