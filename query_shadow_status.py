#!/usr/bin/env python3
"""Shadow scoring + Optuna A/B status read for /intel?tab=shadow.

Pivots: this instance does NOT have classic Optuna study tables. The
`optuna_shadow_config` row is the actual A/B comparison window state. We
surface its real fields (started_at, comparisons, prod/optuna fire counts,
generated_at, disagreements) instead of inventing a dormant timer.

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
    out: Dict[str, Any] = {"shadow": {}, "optuna_ab": {}}
    try:
        with sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=4.0) as conn:
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

            # Optuna A/B comparison window — real schema
            ab = conn.execute(
                "SELECT enabled, started_at, stopped_at, "
                "       optuna_params_generated_at, total_comparisons, "
                "       prod_fires_count, optuna_fires_count, "
                "       disagreements_count, last_enabled_by, last_reason, "
                "       optuna_params_snapshot_json "
                "FROM optuna_shadow_config WHERE id=1"
            ).fetchone()

            if ab is None:
                out["optuna_ab"] = {"present": False}
            else:
                ab_d = dict(ab)
                snap_summary = None
                snap_raw = ab_d.get("optuna_params_snapshot_json")
                if snap_raw:
                    try:
                        snap = json.loads(snap_raw)
                        snap_summary = {
                            "n_trials": snap.get("n_trials"),
                            "n_simulated_trades": snap.get("n_simulated_trades"),
                            "n_trades_evaluated": snap.get("n_trades_evaluated"),
                            "win_rate": snap.get("win_rate"),
                            "sharpe_ratio": snap.get("sharpe_ratio"),
                            "total_pnl": snap.get("total_pnl"),
                            "max_drawdown": snap.get("max_drawdown"),
                            "confidence_floor": snap.get("confidence_floor"),
                        }
                    except Exception:
                        snap_summary = None

                total = int(ab_d.get("total_comparisons") or 0)
                prod = int(ab_d.get("prod_fires_count") or 0)
                opt = int(ab_d.get("optuna_fires_count") or 0)
                dis = int(ab_d.get("disagreements_count") or 0)
                disagree_rate = round((dis / total * 100.0), 2) if total else 0.0

                out["optuna_ab"] = {
                    "present": True,
                    "enabled": bool(ab_d.get("enabled")),
                    "started_at": ab_d.get("started_at"),
                    "stopped_at": ab_d.get("stopped_at"),
                    "params_generated_at": ab_d.get("optuna_params_generated_at"),
                    "total_comparisons": total,
                    "prod_fires_count": prod,
                    "optuna_fires_count": opt,
                    "disagreements_count": dis,
                    "disagreement_rate_pct": disagree_rate,
                    "last_enabled_by": ab_d.get("last_enabled_by"),
                    "last_reason": ab_d.get("last_reason"),
                    "params_snapshot": snap_summary,
                }

        print(json.dumps(out))
    except Exception as exc:
        print(json.dumps({"shadow": {}, "optuna_ab": {}, "error": str(exc)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
