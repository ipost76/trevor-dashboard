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

🚨 `status` REPORTS THE READ, NOT THE COUNT — three states:
    "ok"           the store was read successfully. `entries` may legitimately be
                   0; a successful read of an empty store IS a real answer.
    "no_data_yet"  the store has not been built — neither memory table exists.
    "unavailable"  the store could not be read (missing file, read error).

This used to be `status = "ok" if entries > 0 else "no_data_yet"` — derived from
the COUNT. That made a successful read of the live empty store byte-identical to a
nonexistent database: both emitted `no_data_yet` with `entries: 0`. The renderer
therefore had nothing true to branch on, and three different worlds — a real empty
store, an unbuilt store, and a failed read — all displayed the same confident `0`.
A count can never tell you whether the count is trustworthy; only the read can.

🚨 PRE-CUTOVER EMPTY IS STILL THE DISPLAY, NOT AN ERROR, and this still `exit(0)`s
in every case — never a red error, never a 500. Only the discriminator is honest
now.

🚨 `memory_projection_enabled` REPORTS A SWITCH POSITION, NOT A MEASUREMENT (RM-TRAINER-B4).
Every table counted above is written only behind ``MEMORY_REASONING_ENABLED`` — the
projection sweep (`memory_reasoning.refresh_reasoning_log`) AND `write_watcher_lesson`
share the one `_enabled()` gate. With the flag off the counts are not a finding about
the memory layer; they are the flag, rendered as a number. A count can never tell you
whether anything was wired to produce it, so the flag is reported alongside it.

🚨 RESOLVED THE SAME WAY THE LOOP RESOLVES IT — `_truthy` below is copied verbatim from
``trainer_loop._truthy`` (os.environ, same truthy set, same absent-means-off default), so
the Hub and the loop can never disagree about the switch position. It is READ LIVE; a
hardcoded value becomes a lie the day the flag is armed, which is the defect this exists
to remove.

⚠️ THE ONE DIVERGENCE WINDOW, STATED SO IT IS NOT REDISCOVERED. Both processes take this
key from the SAME file — `.env.local` is the `EnvironmentFile=` of both
`trevor-dashboard.service` and `trevor-trainer-observe.service` — but each snapshots it at
START. So after adding the flag, BOTH must be restarted before the Hub and the loop agree;
restarting only the trainer leaves the Hub honestly reporting its own stale snapshot.
Reading `.env.local` directly was considered and REJECTED: that is a SECOND resolution
order the loop does not use, and it would report ON for a trainer that has not restarted —
a more confident lie than the one being fixed.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from typing import Any, Optional

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB = os.environ.get("MEMORY_DB_PATH") or os.path.join(_SCRIPT_DIR, "data", "memory.db")
# The projection's SOURCE store. Path resolution mirrors query_trainer_reasoning.py
# (TRAINER_DB_PATH env override, else <repo>/data/trainer.db from THIS file's location) —
# always the data/ path, never a bare relative name that would mint a stray repo-root DB.
TRAINER_DB = os.environ.get("TRAINER_DB_PATH") or os.path.join(_SCRIPT_DIR, "data", "trainer.db")


MEMORY_TABLES = ("trainer_memory", "watcher_memory")

# The two sources memory_projection.run_projection sweeps. BOTH are read: naming only
# rejection_log would understate "is there anything to project?" — standing_hypotheses
# is an equal source and is separately empty today.
PROJECTION_SOURCE_TABLES = ("rejection_log", "standing_hypotheses")

MEMORY_REASONING_FLAG = "MEMORY_REASONING_ENABLED"


def _truthy(name: str) -> bool:
    """VERBATIM from trainer_loop._truthy — do not "improve" it independently.

    The value of this function is that it is byte-identical to the loop's, so a key the
    loop reads as on can never read as off here. Any divergence (a wider truthy set, a
    file fallback, a default) re-opens the disagreement it exists to close.
    """
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def _empty(
    status: str,
    error: Optional[str] = None,
    *,
    projection_enabled: bool = False,
    source_rows: Optional[int] = None,
) -> dict[str, Any]:
    """The empty shape under an explicit status — never a count-derived guess.

    The flag and the source count are resolved independently of memory.db, so they are
    carried on EVERY shape including the failure ones — a store we could not read still
    has a knowable switch position.
    """
    out: dict[str, Any] = {
        "status": status,
        "entries": 0,
        "tiers": {"H": 0, "W": 0, "C": 0},
        "memory_projection_enabled": projection_enabled,
        "source_rows": source_rows,
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


def _source_rows() -> Optional[int]:
    """Total rows across the projection's two sources, or None when unreadable.

    🚨 None IS NOT ZERO. "There is nothing to project" is a claim ABOUT THE SOURCES; a
    failed read cannot make it. Returning 0 here would put a number nobody measured on
    screen — the same defect class as the breaker gauge that rendered an absent reading
    as `0.0%`. The renderer says nothing about the sources when this is null.
    """
    try:
        conn = sqlite3.connect(f"file:{TRAINER_DB}?mode=ro", uri=True, timeout=8.0)
    except Exception:
        return None
    try:
        total = 0
        for table in PROJECTION_SOURCE_TABLES:
            # An absent source table genuinely holds no rows to project — that is 0,
            # not unknown. Only a failed READ is unknown.
            if not _table_exists(conn, table):
                continue
            total += int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
        return total
    except Exception:
        return None
    finally:
        conn.close()


def main() -> int:
    # Both are independent of memory.db, so they are resolved FIRST and carried on every
    # shape below — including the ones that could not read the store.
    projection_enabled = _truthy(MEMORY_REASONING_FLAG)
    source_rows = _source_rows()

    try:
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=8.0)
        conn.row_factory = sqlite3.Row
    except Exception as exc:
        # Could not open the store at all — we know nothing about it.
        print(json.dumps(_empty(
            "unavailable", f"{type(exc).__name__}: {exc}",
            projection_enabled=projection_enabled, source_rows=source_rows,
        )))
        return 0

    try:
        # "Has the store been built?" is a question about the SCHEMA, and it is
        # the only thing that separates an unbuilt store from a real empty one.
        built = any(_table_exists(conn, t) for t in MEMORY_TABLES)
        entries = sum(_count(conn, t) for t in MEMORY_TABLES)
        tiers = _tier_counts(conn)
    except Exception as exc:
        conn.close()
        print(json.dumps(_empty(
            "unavailable", f"{type(exc).__name__}: {exc}",
            projection_enabled=projection_enabled, source_rows=source_rows,
        )))
        return 0
    conn.close()

    if not built:
        print(json.dumps(_empty(
            "no_data_yet",
            projection_enabled=projection_enabled, source_rows=source_rows,
        )))
        return 0

    # The read succeeded. `entries` is a real answer even when it is 0 — but whether it is
    # a MEASUREMENT depends on `memory_projection_enabled`, which the renderer branches on.
    print(json.dumps({
        "status": "ok",
        "entries": entries,
        "tiers": tiers,
        "memory_projection_enabled": projection_enabled,
        "source_rows": source_rows,
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
