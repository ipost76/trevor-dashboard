#!/usr/bin/env python3
"""
Optuna A/B Shadow — Hub read helper.

Called by /api/optuna/route.ts for read-only status snapshot + full config.
Uses `mode=ro` URI. NEVER writes.

Usage:
    python3 query_optuna_shadow.py [status]     # default, returns config + derived rates
    python3 query_optuna_shadow.py recent [N]   # returns N most recent comparison rows

Output: JSON on stdout, single object or {"rows":[...]}.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from typing import Any

DB_PATH = "/home/trevor/trevor/trevor.db"


def _ro_connect() -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=5.0)
    conn.row_factory = sqlite3.Row
    return conn


def status() -> dict[str, Any]:
    conn = _ro_connect()
    try:
        cfg_row = conn.execute(
            """SELECT enabled, started_at, stopped_at, optuna_params_generated_at,
                      total_comparisons, prod_fires_count, optuna_fires_count,
                      disagreements_count, last_enabled_by, last_reason, updated_at
               FROM optuna_shadow_config WHERE id=1"""
        ).fetchone()

        last_ts_row = conn.execute(
            "SELECT MAX(timestamp) FROM optuna_shadow_scoring"
        ).fetchone()

        recent_row = conn.execute(
            """SELECT COUNT(*) AS n,
                      SUM(both_fire) AS both,
                      SUM(only_prod_fires) AS only_prod,
                      SUM(only_optuna_fires) AS only_opt,
                      SUM(neither_fires) AS neither
               FROM optuna_shadow_scoring
               WHERE timestamp > datetime('now', '-1 hour', 'localtime')"""
        ).fetchone()
    finally:
        conn.close()

    if not cfg_row:
        return {
            "enabled": False,
            "error": "optuna_shadow_config row missing",
        }

    cfg = dict(cfg_row)
    total = int(cfg.get("total_comparisons") or 0)
    disag = int(cfg.get("disagreements_count") or 0)
    agreement_rate = (1.0 - (disag / total)) if total > 0 else 0.0

    recent = dict(recent_row) if recent_row else {}

    return {
        "enabled": bool(cfg.get("enabled")),
        "started_at": cfg.get("started_at"),
        "stopped_at": cfg.get("stopped_at"),
        "optuna_params_generated_at": cfg.get("optuna_params_generated_at"),
        "total_comparisons": total,
        "prod_fires_count": int(cfg.get("prod_fires_count") or 0),
        "optuna_fires_count": int(cfg.get("optuna_fires_count") or 0),
        "disagreements_count": disag,
        "agreement_rate": round(agreement_rate, 4),
        "last_enabled_by": cfg.get("last_enabled_by"),
        "last_reason": cfg.get("last_reason"),
        "updated_at": cfg.get("updated_at"),
        "last_comparison_ts": last_ts_row[0] if last_ts_row else None,
        "last_hour": {
            "n": int(recent.get("n") or 0),
            "both_fire": int(recent.get("both") or 0),
            "only_prod_fires": int(recent.get("only_prod") or 0),
            "only_optuna_fires": int(recent.get("only_opt") or 0),
            "neither_fires": int(recent.get("neither") or 0),
        },
    }


def recent(limit: int = 20) -> dict[str, Any]:
    conn = _ro_connect()
    try:
        rows = conn.execute(
            """SELECT id, timestamp, ticker, direction,
                      prod_confidence, prod_effective_threshold, prod_would_fire,
                      optuna_confidence, optuna_effective_threshold, optuna_would_fire,
                      both_fire, only_prod_fires, only_optuna_fires, neither_fires,
                      aggressive_mode_active, linked_signal_id
               FROM optuna_shadow_scoring
               ORDER BY id DESC LIMIT ?""",
            (int(limit),),
        ).fetchall()
    finally:
        conn.close()
    return {"rows": [dict(r) for r in rows]}


def main() -> int:
    args = sys.argv[1:]
    cmd = args[0] if args else "status"
    try:
        if cmd == "status":
            result = status()
        elif cmd == "recent":
            limit = int(args[1]) if len(args) > 1 else 20
            result = recent(limit)
        else:
            result = {"error": f"unknown command: {cmd}"}
        print(json.dumps(result, default=str))
        return 0
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
