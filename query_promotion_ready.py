#!/usr/bin/env python3
"""query_promotion_ready.py — PROMOTIONS subtab backend (RM-SHADOW-PROMOTE B2/B4).

GET /api/shadow/promotions returns Ghost's two-sided promotion worklist: the
shadows B3's nightly gate has SURFACED — promote candidates (state='ready') and
cull candidates (state='removed'). The auto-stamped accruing in_progress flood
is NEVER shown.

FILTER = the surfaced set; `surfaced` is the single display authority (B4):
  • `WHERE surfaced=1`  when B3's `surfaced` column exists (authoritative)
  • `WHERE state IN ('ready','removed')`  graceful fallback BEFORE B3 lands the
    column — still never shows accruing in_progress in the meantime.
The column is detected at query time; a manual in_progress only appears once
B3/Ghost sets its surfaced=1.

DISMISS (B2, RM-SHADOW-CULL): acknowledged rows are dropped —
`… AND (acknowledged=0 OR acknowledged IS NULL)` when the `acknowledged` column
exists (column-detected, fail-soft like `surfaced`). A handled removal Ghost
marks acknowledged=1 (CC-driven `ssh vm` write; the Hub never writes the DB)
leaves the active REMOVE worklist while its permanent tombstone stays in
shadow_history.db. Absent column (pre-replication) → no filter → all rows show.

Fields surfaced (a glanceable subset of the C1 schema — deep stats live on
/health, shadow inventory on the Shadow tab):
  shadow_name · description · state · n_distinct · expectancy_usd ·
  verdict_summary (carries the REMOVE 'why': BLOCKED (loss|noise|dead)) ·
  first_ready_at · updated_at
plus a top-level replica-freshness stamp (the WSL litestream replica refreshes
every ~15 min via trevor-restore.timer, so a glance knows the list may lag).

DECOUPLED + FAIL-SOFT: the table is EMPTY until B3's nightly gate surfaces rows
(air-gapped off-loop job). This script NEVER 500s — a missing table, a missing
column (incl. `surfaced` pre-B3), an old replica, or any read error returns an
empty list, so the subtab renders its friendly empty-state rather than erroring.

READ-ONLY (`mode=ro`). Never writes the DB, never imports `hyperliquid`. The Hub
displays only — all state transitions + the `surfaced` flag are B3's VM job.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Optional

DB = "/home/trevor/trevor/trevor.db"  # symlink → /home/ghost/trevor-replica/trevor.db on WSL

# Two-sided worklist grouping: 'ready' = promote, 'removed' = cull,
# 'in_progress' = a MANUAL promote-in-flight (only reaches here if B3 surfaced
# it). Accruing shadows are NEVER surfaced. The surfaced set is chosen per query
# (surfaced=1 authoritative, else the state fallback that still drops accruing).

# Glanceable columns the PromotionsList renders (confirmed against the C1 schema).
COLUMNS = (
    "shadow_name",
    "description",
    "state",
    "n_distinct",
    "expectancy_usd",
    "verdict_summary",
    "first_ready_at",
    "updated_at",
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


def _has_column(conn: sqlite3.Connection, table: str, col: str) -> bool:
    """True if `table` has `col`. Fail-soft to False (→ state fallback filter)."""
    try:
        return any(
            r["name"] == col
            for r in conn.execute(f"PRAGMA table_info({table})").fetchall()
        )
    except sqlite3.Error:
        return False


def _read_promotions(conn: sqlite3.Connection) -> list[dict]:
    """Surfaced worklist rows: ready-block first, then removed, newest first.

    B3's `surfaced` flag is the single display authority — `WHERE surfaced=1`.
    Before B3 lands the column we fall back to `WHERE state IN ('ready','removed')`
    so the accruing in_progress flood is NEVER shown either way. Fail-soft to []
    on a missing table or any schema drift — a missing gate is an empty list,
    never a 500.
    """
    if not _table_exists(conn, "promotion_ready"):
        return []

    cols = ", ".join(COLUMNS)
    if _has_column(conn, "promotion_ready", "surfaced"):
        where = "surfaced = 1"  # B3 authoritative: ready + remove-candidates
    else:
        # Pre-B3: hardcoded literal states (no user input) — accruing dropped.
        where = "state IN ('ready', 'removed')"

    # B2 (RM-SHADOW-CULL): drop acknowledged rows so the REMOVE list is an
    # actionable worklist, not a growing archive. Ghost marks a handled removal
    # acknowledged=1 (CC-driven `ssh vm` write — the Hub stays read-only) and it
    # leaves the active worklist while its tombstone stays in shadow_history.db.
    # Column-detected + fail-soft (mirrors the `surfaced` guard): absent on the
    # WSL replica during the ~20-min tailsync gap after the VM ALTER → no filter
    # appended → every surfaced row still shows (treated as acknowledged=0),
    # never a 500. The dismiss control is REMOVE-only, so only state='removed'
    # rows ever carry acknowledged=1 in practice.
    if _has_column(conn, "promotion_ready", "acknowledged"):
        where += " AND (acknowledged = 0 OR acknowledged IS NULL)"

    # ready → in_progress(manual) → removed; within each, most-recently-flagged
    # first. Removed/in_progress rows carry no first_ready_at, so COALESCE onto
    # updated_at keeps them ordered (NULLs last).
    sql = (
        f"SELECT {cols} FROM promotion_ready "
        f"WHERE {where} "
        f"ORDER BY CASE state WHEN 'ready' THEN 0 WHEN 'in_progress' THEN 1 "
        f"WHEN 'removed' THEN 2 ELSE 3 END, "
        f"COALESCE(first_ready_at, updated_at) IS NULL, "
        f"COALESCE(first_ready_at, updated_at) DESC"
    )
    try:
        rows = conn.execute(sql).fetchall()
    except sqlite3.OperationalError:
        # Column/table shape drift → empty view, never a crash.
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
                "updated_at": r["updated_at"],
            }
        )
    return out


def _error_code(exc: Exception) -> str:
    """Classify a read failure into a code the route can translate.

    🚨 A DIAGNOSTIC IS NOT USER COPY (B13). This used to emit
    `OperationalError: no such table: promotion_ready` into an `error` field the
    Hub rendered verbatim as the TRAINER empty state. The exception class and
    the table name are for the server log; the SCREEN gets a sentence chosen by
    `plainReaderError()` in `src/lib/plain-labels.ts`.
    """
    if isinstance(exc, sqlite3.OperationalError) and "no such table" in str(exc):
        return "no_table"
    return "query_failed"


def _fail(age, mtime, code: str, exc: Exception) -> int:
    """Fail-soft payload: a stable code for the client, the raw text for the log.

    `error_detail` is READ AND STRIPPED by the route, which logs it server-side
    (`console.error`) and never forwards it. Keeping it here rather than writing
    to stderr is deliberate: this path exits 0, and `runPython` only surfaces
    stderr on a NON-zero exit, so a stderr write would be silently discarded —
    which would log LESS than today, not more.
    """
    print(json.dumps({
        "promotions": [], "total": 0,
        "replica_age_seconds": age, "replica_mtime": mtime,
        "error_code": code,
        "error_detail": f"{type(exc).__name__}: {exc}",
    }))
    return 0


def main() -> int:
    age, mtime = _replica_age()
    try:
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=8.0)
        conn.row_factory = sqlite3.Row
    except Exception as exc:
        return _fail(age, mtime, "db_unavailable", exc)

    try:
        promotions = _read_promotions(conn)
    except Exception as exc:
        conn.close()
        return _fail(age, mtime, _error_code(exc), exc)
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
