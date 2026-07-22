#!/usr/bin/env python3
"""query_trainer_pause.py — R12-B3: read the trainer PAUSE control state (Hub side).

Backs GET /api/trainer/pause. READ-ONLY (`mode=ro`) over the litestream replica
(`/home/trevor/trevor/trevor.db` → /home/ghost/trevor-replica/trevor.db on WSL).
Never writes the DB, never imports hyperliquid, never touches auto_config.

Returns:
  - enabled: is HUB_PAUSE_CONTROL_ENABLED on? (the UI renders the control only
    when true; default OFF=absent → false → hidden). The gate is enforced
    AUTHORITATIVELY VM-side by gw_exec; this read is display-only.
  - paused / scope / requested_at / requested_by / reason: the durable pause
    REQUEST recorded by set_trainer_pause.py (VM-side, via the gateway). The
    trainer daemon must POLL this to actually stop — wiring lands in R13; until
    then it records INTENT only. NEVER surfaced as an asserted daemon state.
  - replica_age_seconds / replica_mtime: honest freshness of this read (the pause
    state is written VM-side, so the Hub sees it after the ~15-30 min litestream
    lag; the POST response reflects a write immediately regardless).

🚨 PRE-CUTOVER EMPTY IS THE DISPLAY: an absent trainer_pause_state table / absent
flag row is the EXPECTED state (both default OFF) → enabled:false, paused:false,
never an error.
"""
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Any, Optional

DB = "/home/trevor/trevor/trevor.db"  # symlink → /home/ghost/trevor-replica/trevor.db on WSL
FLAG = "HUB_PAUSE_CONTROL_ENABLED"
_TRUE = {"1", "true", "on", "yes"}


def _replica_age() -> tuple[Optional[int], Optional[str]]:
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


def main() -> int:
    age, mtime = _replica_age()
    out: dict[str, Any] = {
        "enabled": False,
        "paused": False,
        "scope": None,
        "requested_at": None,
        "requested_by": None,
        "reason": None,
        "replica_age_seconds": age,
        "replica_mtime": mtime,
        "error": None,
    }
    try:
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=8.0)
        conn.row_factory = sqlite3.Row
        try:
            # the gate — absent row = default OFF
            if _table_exists(conn, "auto_config"):
                r = conn.execute(
                    "SELECT value FROM auto_config WHERE key=?", (FLAG,)
                ).fetchone()
                if r is not None and r["value"] is not None:
                    out["enabled"] = str(r["value"]).strip().lower() in _TRUE

            # the durable pause request — absent table = pre-cutover empty (not paused)
            if _table_exists(conn, "trainer_pause_state"):
                p = conn.execute(
                    "SELECT paused, scope, requested_at, requested_by, reason "
                    "FROM trainer_pause_state WHERE id=1"
                ).fetchone()
                if p is not None:
                    out["paused"] = bool(p["paused"])
                    out["scope"] = p["scope"]
                    out["requested_at"] = p["requested_at"]
                    out["requested_by"] = p["requested_by"]
                    out["reason"] = p["reason"]
        finally:
            conn.close()
    except Exception as exc:  # noqa: BLE001 — fail-soft; the route must never 500
        out["error"] = f"{type(exc).__name__}: {exc}"

    print(json.dumps(out, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
