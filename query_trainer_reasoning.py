#!/usr/bin/env python3
"""query_trainer_reasoning.py — TRAINER page · "reasoning" sub-tab backend (R12-B1).

Backs GET /api/trainer/reasoning — the "why it was rejected" narrative, read from
the R9 trainer's `rejection_log` (WSL-local `trainer.db`). Each row is one
config the trainer PROPOSED and then rejected, with the fired gates + the
real rationale + the statistics that killed it:
  failing_gates (from failing_gates_json) · rationale (rationale_text) ·
  p_value · dsr (deflated Sharpe) · the proposed config · arm_hash · level_id · ts.

READ-ONLY (`mode=ro`). Never writes the DB, never imports `hyperliquid`, never
imports `lib.trainer_db` (a reader must not lazily build the DB). Path resolution
mirrors lib/trainer_db.resolve_db_path (TRAINER_DB_PATH env override, else
<repo>/data/trainer.db recomputed from THIS file's location).

🚨 PRE-CUTOVER EMPTY IS THE DISPLAY, NOT AN ERROR. `rejection_log` is 0-row until
R13 starts the search loop. A missing table / missing file / any read error
returns the empty shape with `exit(0)` — the sub-tab renders its <EmptyState>,
never a red error, never a 500.

NAMING: `query_*`-prefixed (NOT `trainer_*`) so the watcher-independence AST
guard's `trainer_*.py` glob never sweeps it in.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from typing import Any, Optional

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB = os.environ.get("TRAINER_DB_PATH") or os.path.join(_SCRIPT_DIR, "data", "trainer.db")


def _empty(error: Optional[str] = None) -> dict[str, Any]:
    out: dict[str, Any] = {"status": "no_data_yet", "rejections": [], "count": 0}
    if error is not None:
        out["error"] = error
    return out


def _load_json(raw: Optional[str]) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).fetchone()
        is not None
    )


def _read_rejections(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    if not _table_exists(conn, "rejection_log"):
        return []
    rows = conn.execute(
        "SELECT id, arm_hash, level_id, config_json, failing_gates_json, "
        "rationale_text, p_value, dsr, ts FROM rejection_log "
        "ORDER BY ts DESC, id DESC"
    ).fetchall()
    return [{
        "id": r["id"],
        "arm_hash": r["arm_hash"],
        "level_id": r["level_id"],
        "config": _load_json(r["config_json"]),
        "failing_gates": _load_json(r["failing_gates_json"]),
        "rationale": r["rationale_text"],
        "p_value": r["p_value"],
        "dsr": r["dsr"],
        "ts": r["ts"],
    } for r in rows]


def main() -> int:
    try:
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=8.0)
        conn.row_factory = sqlite3.Row
    except Exception as exc:
        print(json.dumps(_empty(f"{type(exc).__name__}: {exc}")))
        return 0

    try:
        rejections = _read_rejections(conn)
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
        "status": "ok" if rejections else "no_data_yet",
        "rejections": rejections,
        "count": len(rejections),
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
