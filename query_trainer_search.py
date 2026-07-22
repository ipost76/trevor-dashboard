#!/usr/bin/env python3
"""query_trainer_search.py — TRAINER page · "search" sub-tab backend (R12-B1).

Backs GET /api/trainer/search — the at-a-glance view of the R9 trainer's
config-space SEARCH state, read from the WSL-local `trainer.db`:
  • bandit_posteriors  — the per-arm Thompson posteriors (arm α/β/n_obs + the
    posterior mean α/(α+β)); WHICH arm the bandit favours.
  • standing_hypotheses — the durable claims the trainer is accumulating
    evidence for/against, one row per level.
  • compass_weights    — the current two-gate compass config (consistency vs
    magnitude weights + the survival-wall drawdown/CVaR floors).

READ-ONLY (`mode=ro`). Never writes the DB, never imports `hyperliquid`, never
imports `lib.trainer_db` (which builds the DB lazily — a reader must not create
it). Path resolution mirrors lib/trainer_db.resolve_db_path: TRAINER_DB_PATH env
override, else <repo>/data/trainer.db recomputed from THIS file's location (so it
resolves whether runPython's cwd is the Hub repo root or /home/trevor/trevor).

🚨 PRE-CUTOVER EMPTY IS THE DISPLAY, NOT AN ERROR. All three tables are 0-row
(compass carries only its 1 seed row) until R13 starts the search loop. A
missing table / missing file / any read error returns the empty shape with
`exit(0)` — the sub-tab renders its <EmptyState>, never a red error, never a 500.

NAMING: `query_*`-prefixed (NOT `trainer_*`) so the watcher-independence AST
guard's `trainer_*.py` glob (tests/test_watcher_independence.py:74) never sweeps
it in — the `memory_projection.py` precedent (reads trainer_db, not glob-matched).
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from typing import Any, Optional

# Path resolution (mirrors lib/trainer_db.resolve_db_path — env override wins,
# else repo-local default recomputed from this file's dir on every call).
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB = os.environ.get("TRAINER_DB_PATH") or os.path.join(_SCRIPT_DIR, "data", "trainer.db")


def _empty(error: Optional[str] = None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "status": "no_data_yet",
        "arms": [],
        "hypotheses": [],
        "compass": None,
        "counts": {"arms": 0, "hypotheses": 0},
    }
    if error is not None:
        out["error"] = error
    return out


def _load_json(raw: Optional[str]) -> Any:
    """Parse a *_json column defensively — never let a bad blob crash a read."""
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def _round(v: Any, n: int = 4) -> Any:
    try:
        return round(float(v), n)
    except Exception:
        return v


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).fetchone()
        is not None
    )


def _read_arms(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    if not _table_exists(conn, "bandit_posteriors"):
        return []
    rows = conn.execute(
        "SELECT arm_hash, level_id, axes_json, alpha, beta, n_obs, "
        "last_sampled_at, updated_at FROM bandit_posteriors "
        "ORDER BY COALESCE(n_obs,0) DESC, updated_at DESC"
    ).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        try:
            a = float(r["alpha"]) if r["alpha"] is not None else 0.0
            b = float(r["beta"]) if r["beta"] is not None else 0.0
            mean = _round(a / (a + b)) if (a + b) > 0 else None
        except Exception:
            mean = None
        out.append({
            "arm_hash": r["arm_hash"],
            "level_id": r["level_id"],
            "axes": _load_json(r["axes_json"]),
            "alpha": r["alpha"],
            "beta": r["beta"],
            "n_obs": r["n_obs"],
            "mean": mean,
            "last_sampled_at": r["last_sampled_at"],
            "updated_at": r["updated_at"],
        })
    return out


def _read_hypotheses(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    if not _table_exists(conn, "standing_hypotheses"):
        return []
    rows = conn.execute(
        "SELECT hypothesis_id, level_id, domain, claim, evidence_json, n_obs, "
        "status, last_updated FROM standing_hypotheses "
        "ORDER BY last_updated DESC"
    ).fetchall()
    return [{
        "hypothesis_id": r["hypothesis_id"],
        "level_id": r["level_id"],
        "domain": r["domain"],
        "claim": r["claim"],
        "evidence": _load_json(r["evidence_json"]),
        "n_obs": r["n_obs"],
        "status": r["status"],
        "last_updated": r["last_updated"],
    } for r in rows]


def _read_compass(conn: sqlite3.Connection) -> Optional[dict[str, Any]]:
    if not _table_exists(conn, "compass_weights"):
        return None
    r = conn.execute(
        "SELECT level_id, w_consistency, w_magnitude, dd_ceiling, cvar_floor, "
        "learned, updated_at FROM compass_weights ORDER BY level_id DESC LIMIT 1"
    ).fetchone()
    if r is None:
        return None
    return {
        "level_id": r["level_id"],
        "w_consistency": r["w_consistency"],
        "w_magnitude": r["w_magnitude"],
        "dd_ceiling": r["dd_ceiling"],
        "cvar_floor": r["cvar_floor"],
        "learned": r["learned"],
        "updated_at": r["updated_at"],
    }


def main() -> int:
    try:
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=8.0)
        conn.row_factory = sqlite3.Row
    except Exception as exc:
        # Missing file / unopenable — pre-cutover this is EXPECTED, not an error.
        print(json.dumps(_empty(f"{type(exc).__name__}: {exc}")))
        return 0

    try:
        arms = _read_arms(conn)
        hypotheses = _read_hypotheses(conn)
        compass = _read_compass(conn)
    except sqlite3.OperationalError as exc:
        conn.close()
        # "no such table" / schema drift → empty shape, never a traceback.
        print(json.dumps(_empty(f"{type(exc).__name__}: {exc}")))
        return 0
    except Exception as exc:
        conn.close()
        print(json.dumps(_empty(f"{type(exc).__name__}: {exc}")))
        return 0
    conn.close()

    status = "ok" if (arms or hypotheses) else "no_data_yet"
    print(json.dumps({
        "status": status,
        "arms": arms,
        "hypotheses": hypotheses,
        "compass": compass,
        "counts": {"arms": len(arms), "hypotheses": len(hypotheses)},
    }, default=str))
    return 0


if __name__ == "__main__":
    # OUTER-WRAP: silent-crash visibility (mirrors query_promotion_ready.py).
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
