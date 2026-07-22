#!/usr/bin/env python3
"""query_capability_queue.py — TRAINER page · "capability" sub-tab backend (R12-B1 · H8).

Backs GET /api/trainer/capability-queue — the capability-request queue the R9
trainer routes to Ghost. When the trainer proposes a CAPABILITY change (a new
config axis / a growth request it cannot self-shadow), it writes a REQUEST row
to `capability_requests` on the VM `trevor.db` (read here through the 0444 WSL
replica, `mode=ro`); Ghost turns each into a CC prompt. This surface is
read-only display: "the loop routed a request; Ghost turns it into a CC prompt."

🚨 THE HUB NEVER WRITES HERE. A CC prompt services the queue (human-gated
growth — R9 invariant 1: the loop never writes code). This reader only READS.

Schema-tolerant: `capability_requests` is ABSENT until R13 (the loop creates it
lazily on the first capability proposal), so its exact columns are unknown to
this build. We `SELECT *` and emit each row's full column→value map (parsing any
`*_json` column, e.g. the requested axes), plus stable `shadow_id`/`status` keys.

READ-ONLY (`mode=ro`). Never writes the DB, never imports `hyperliquid`.

🚨 PRE-CUTOVER EMPTY IS THE DISPLAY, NOT AN ERROR. `no such table` / missing file
/ any read error → empty list + `exit(0)` — <EmptyState>, never a 500.
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
        "requests": [],
        "count": 0,
        "replica_age_seconds": age,
        "replica_mtime": mtime,
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


def _row_to_dict(r: sqlite3.Row) -> dict[str, Any]:
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
    d.setdefault("shadow_id", r["shadow_id"] if "shadow_id" in r.keys() else None)
    d.setdefault("status", r["status"] if "status" in r.keys() else None)
    return d


def _read_requests(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    if not _table_exists(conn, "capability_requests"):
        return []
    try:
        rows = conn.execute("SELECT * FROM capability_requests").fetchall()
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
        requests = _read_requests(conn)
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
        "status": "ok" if requests else "no_data_yet",
        "requests": requests,
        "count": len(requests),
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
