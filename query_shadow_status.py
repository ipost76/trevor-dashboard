#!/usr/bin/env python3
"""Shadow scoring status read for /intel?tab=shadow.

shadow_scoring uses `timestamp` column (not `scored_at`).
"""
from __future__ import annotations

import json
import sqlite3
import sys
from typing import Any, Dict

DB = "/home/trevor/trevor/trevor.db"
SHADOW_ROWS_REQUIRED = 200    # FUTURE_01 threshold


def main():
    out: Dict[str, Any] = {"shadow": {}}
    try:
        with sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10) as conn:
            conn.row_factory = sqlite3.Row

            # Shadow scoring rollup
            tbl = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='shadow_scoring'"
            ).fetchone()
            if tbl:
                count = conn.execute("SELECT COUNT(*) FROM shadow_scoring").fetchone()[0]
                last = conn.execute(
                    "SELECT timestamp FROM shadow_scoring ORDER BY timestamp DESC LIMIT 1"
                ).fetchone()
                last_at = last[0] if last else None
            else:
                count = 0
                last_at = None

            cfg_rows = conn.execute(
                "SELECT key, value FROM auto_config WHERE key IN ("
                "'SHADOW_SCORING_ENABLED','SHADOW_LAST_RETRAIN_ISO',"
                "'SHADOW_MODEL_METHOD','HMM_REGIME_SOURCE')"
            ).fetchall()
            cfg = {r[0]: r[1] for r in cfg_rows}

            out["shadow"] = {
                "rows": count,
                "rows_required_for_analysis": SHADOW_ROWS_REQUIRED,
                "ready_for_analysis": count >= SHADOW_ROWS_REQUIRED,
                "last_score_at": last_at,
                "model_method": cfg.get("SHADOW_MODEL_METHOD", "hmm+ds"),
                "last_retrain_iso": cfg.get("SHADOW_LAST_RETRAIN_ISO"),
                "hmm_regime_source": cfg.get("HMM_REGIME_SOURCE"),
                "enabled": str(cfg.get("SHADOW_SCORING_ENABLED", "true")).lower() == "true",
            }

        print(json.dumps(out))
    except Exception as exc:
        print(json.dumps({"shadow": {}, "error": str(exc)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
