#!/usr/bin/env python3
"""query_promotion_candidates.py — TRAINER page · "promotions" (primary) backend (R12-B1).

Backs GET /api/trainer/promotion-candidates — R8's `promotion_candidates` table
on the VM `trevor.db` (read here through the 0444 WSL replica, `mode=ro`). Each
row is a self-contained candidate record R8's `surface_promotion_candidate`
INSERTs for a one-glance Ghost decision: the proposed config diff + the matched
stats (n / expectancy_usd / net_usd + win-rate / exact_or_bound) + the reasoning
(promotion_ready.verdict_summary), keyed by candidate_id + shadow_id.

🚨 TWO PROMOTION TABLES — DO NOT CONFLATE. This reads `promotion_candidates`
(R8's, R12's PRIMARY promotions surface, ABSENT pre-cutover). The LEGACY
`promotion_ready` readiness-gate (query_promotion_ready.py, 80 live rows) stays a
SEPARATE secondary view — never merged, never deleted.

Schema-tolerant by design: `promotion_candidates` does not exist yet (R8 creates
it lazily on the first post-cutover write), so its exact columns are unknown to
this build. We `SELECT *` and emit each row's full column→value map (parsing any
`*_json` column into an object), plus a stable `candidate_id`/`shadow_id` at the
top so the approve/reject control always has its key. The record lights up
correctly at cutover with no Hub change ("no-first-anchoring" — build against the
documented shape, tolerate the real one).

READ-ONLY (`mode=ro`). Never writes the DB, never imports `hyperliquid`.

🚨 PRE-CUTOVER EMPTY IS THE DISPLAY, NOT AN ERROR. `no such table` / missing file
/ any read error → empty list + `exit(0)`, so the sub-tab renders its
<EmptyState>, never a red error, never a 500.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Any, Optional

DB = "/home/trevor/trevor/trevor.db"  # symlink → /home/ghost/trevor-replica/trevor.db on WSL


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


def _empty(age: Optional[int], mtime: Optional[str], error: Optional[str] = None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "status": "no_data_yet",
        "candidates": [],
        "count": 0,
        "write_enabled": False,
        "replica_age_seconds": age,
        "replica_mtime": mtime,
    }
    if error is not None:
        out["error"] = error
    return out


# tolerant truthy set for auto_config flag values (mirrors gw_exec._TRUE).
_TRUE = {"1", "true", "on", "yes"}


def _write_enabled(conn: sqlite3.Connection) -> bool:
    """Read HUB_PROMOTION_WRITE_ENABLED (auto_config) so the approve/reject control
    renders actionable vs read-only. ADVISORY ONLY — the VM gateway (gw_exec._flag_on)
    is the AUTHORITATIVE gate (423 when off). This replica read can lag the VM ~15-30
    min, so a freshly-flipped flag may show stale here briefly; the write itself is
    always governed by the live VM value. Absent row / any error → False (OFF)."""
    try:
        if not _table_exists(conn, "auto_config"):
            return False
        row = conn.execute(
            "SELECT value FROM auto_config WHERE key='HUB_PROMOTION_WRITE_ENABLED'"
        ).fetchone()
        if row is None or row["value"] is None:
            return False
        return str(row["value"]).strip().lower() in _TRUE
    except sqlite3.Error:
        return False


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).fetchone()
        is not None
    )


def _row_to_dict(r: sqlite3.Row) -> dict[str, Any]:
    """Full column map, parsing any `*_json` column defensively into an object."""
    d: dict[str, Any] = {}
    for k in r.keys():
        v = r[k]
        if k.endswith("_json") and isinstance(v, str) and v:
            try:
                d[k] = json.loads(v)
            except Exception:
                d[k] = v
        else:
            d[k] = v
    # Stable keys the approve/reject control relies on (pass-through if present).
    d.setdefault("candidate_id", r["candidate_id"] if "candidate_id" in r.keys() else None)
    d.setdefault("shadow_id", r["shadow_id"] if "shadow_id" in r.keys() else None)
    return d


def _read_candidates(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    if not _table_exists(conn, "promotion_candidates"):
        return []
    try:
        rows = conn.execute("SELECT * FROM promotion_candidates").fetchall()
    except sqlite3.OperationalError:
        return []
    return [_row_to_dict(r) for r in rows]


def main() -> int:
    age, mtime = _replica_age()
    try:
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=8.0)
        conn.row_factory = sqlite3.Row
    except Exception as exc:
        print(json.dumps(_empty(age, mtime, f"{type(exc).__name__}: {exc}")))
        return 0

    try:
        candidates = _read_candidates(conn)
        write_enabled = _write_enabled(conn)
    except sqlite3.OperationalError as exc:
        conn.close()
        print(json.dumps(_empty(age, mtime, f"{type(exc).__name__}: {exc}")))
        return 0
    except Exception as exc:
        conn.close()
        print(json.dumps(_empty(age, mtime, f"{type(exc).__name__}: {exc}")))
        return 0
    conn.close()

    print(json.dumps({
        "status": "ok" if candidates else "no_data_yet",
        "candidates": candidates,
        "count": len(candidates),
        "write_enabled": write_enabled,
        "replica_age_seconds": age,
        "replica_mtime": mtime,
    }, default=str))
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
