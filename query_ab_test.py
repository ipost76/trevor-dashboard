#!/usr/bin/env python3
"""
Hub query helper for the consolidated signal A/B test framework (RM-03 P21).

Read-only summary of signal_ab_results — joins production-vs-V2 decisions
across every active V2 flag (P07 thresholds, P09 persistence, P10 MTF
asymmetry) and the realized auto_trade outcomes back-attached at close.

Output: single JSON object with two sections:
  * summary       — overall counts + outcome coverage + first/last signal
  * flag_analysis — per-V2-flag: pass/block counts, would-be-winner / loser
                    rates, hypothetical hold-out WR

Bot side (`/home/trevor/trevor/signal_ab_test.py`) owns the table schema +
writer. This helper never writes; it opens the DB in `?mode=ro`.

Usage: python3 query_ab_test.py
"""
from __future__ import annotations

import json
import sqlite3
import sys
from typing import Any

DB = "/home/trevor/trevor/trevor.db"


def _row_to_dict(row: sqlite3.Row | None) -> dict[str, Any]:
    return dict(row) if row is not None else {}


def main() -> int:
    try:
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10)
    except sqlite3.Error as e:
        print(json.dumps({"error": f"db_open_failed: {e}"}))
        return 1

    conn.row_factory = sqlite3.Row

    # If the table hasn't been created yet (pre-first-restart), surface a
    # clear empty payload rather than a tracebacks-y 500.
    table_exists = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='signal_ab_results'"
    ).fetchone()
    if table_exists is None:
        conn.close()
        print(json.dumps({
            "summary": {
                "total_signals": 0,
                "with_outcomes": 0,
                "winners": 0,
                "avg_pnl_pct": None,
                "first_signal": None,
                "last_signal": None,
                "table_initialized": False,
            },
            "flag_analysis": {},
        }))
        return 0

    try:
        summary_row = conn.execute(
            """
            SELECT
                COUNT(*)                                       AS total_signals,
                SUM(CASE WHEN is_winner IS NOT NULL THEN 1 ELSE 0 END)
                                                                AS with_outcomes,
                SUM(CASE WHEN is_winner = 1 THEN 1 ELSE 0 END) AS winners,
                AVG(actual_pnl_pct)                             AS avg_pnl_pct,
                MIN(timestamp)                                  AS first_signal,
                MAX(timestamp)                                  AS last_signal
            FROM signal_ab_results
            """
        ).fetchone()
        summary = _row_to_dict(summary_row)
        summary["table_initialized"] = True

        rows = conn.execute(
            """
            SELECT v2_decisions_json, is_winner, actual_pnl_pct
              FROM signal_ab_results
             WHERE v2_decisions_json IS NOT NULL
               AND is_winner IS NOT NULL
            """
        ).fetchall()
    finally:
        conn.close()

    flag_analysis: dict[str, dict[str, Any]] = {}
    for row in rows:
        try:
            decisions = json.loads(row["v2_decisions_json"]) or {}
        except (json.JSONDecodeError, TypeError):
            continue
        won = bool(row["is_winner"])
        for flag_name, payload in decisions.items():
            if not isinstance(payload, dict):
                continue
            entry = flag_analysis.setdefault(
                flag_name,
                {
                    "n_with_outcome": 0,
                    "n_v2_pass": 0,
                    "n_v2_pass_winners": 0,
                    "n_v2_block": 0,
                    "n_v2_block_winners": 0,
                    "n_prod_pass": 0,
                    "n_prod_pass_winners": 0,
                    "n_divergent": 0,
                },
            )
            entry["n_with_outcome"] += 1
            v2_pass = payload.get("v2_pass")
            prod_pass = payload.get("prod_pass")
            if v2_pass is True:
                entry["n_v2_pass"] += 1
                if won:
                    entry["n_v2_pass_winners"] += 1
            elif v2_pass is False:
                entry["n_v2_block"] += 1
                if won:
                    entry["n_v2_block_winners"] += 1
            if prod_pass is True:
                entry["n_prod_pass"] += 1
                if won:
                    entry["n_prod_pass_winners"] += 1
            if v2_pass is not None and prod_pass is not None and v2_pass != prod_pass:
                entry["n_divergent"] += 1

    # Decorate with rates (None when denominator is zero)
    for entry in flag_analysis.values():
        n_pass = entry["n_v2_pass"]
        n_block = entry["n_v2_block"]
        n_prod = entry["n_prod_pass"]
        entry["v2_pass_wr"] = (entry["n_v2_pass_winners"] / n_pass) if n_pass else None
        entry["v2_block_wr"] = (entry["n_v2_block_winners"] / n_block) if n_block else None
        entry["prod_pass_wr"] = (entry["n_prod_pass_winners"] / n_prod) if n_prod else None

    print(json.dumps({"summary": summary, "flag_analysis": flag_analysis}, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
