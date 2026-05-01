#!/usr/bin/env python3
"""
TREVOR-aware suggested prompts for the chat empty state.

Reads READ-ONLY (file:...?mode=ro). Up to 6 suggestions, each tied to a
currently-resolvable system source. Sources that fail are silently dropped
— no fabricated cards. The script always returns valid JSON to stdout;
the frontend renders whatever the suggestions[] array contains.

Schema notes (vs prompt's draft):
  - signals table is `trade_insights` (no direction column; signal_type
    is LONG/SHORT/HOLD; confidence is 0-1, multiply by 100 for display).
  - closed-trade fact table for calibration sample size is the
    `unified_outcomes` VIEW (paper + backfill + live UNION ALL).
  - Killswitch key is `EMERGENCY_KILLSWITCH` (NOT KILLSWITCH_ENABLED).
  - There is no AGGRESSIVE_MODE boolean — aggressive operation is
    encoded in the `AGGRESSIVE_THRESHOLD` confidence floor (default ≈ 35).

JSON output:
{
  "suggestions": [
    { "id": "open_positions", "label": "...", "subtitle": "...",
      "icon": "TrendingUp" }, ...
  ],
  "context_snapshot_at": "<ISO>",
  "killswitch_enabled": false,
  "aggressive_threshold": 35
}
"""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

DB = "/home/trevor/trevor/trevor.db"


def _config(conn: sqlite3.Connection, key: str) -> Optional[str]:
    row = conn.execute("SELECT value FROM auto_config WHERE key=?", (key,)).fetchone()
    return row[0] if row else None


def _has_table(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE (type='table' OR type='view') AND name=?",
        (name,),
    ).fetchone()
    return row is not None


def main() -> None:
    suggestions: List[Dict[str, Any]] = []
    killswitch_on = False
    aggressive_threshold: Optional[int] = None

    try:
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=4.0)
    except sqlite3.OperationalError as exc:
        print(json.dumps({"suggestions": [], "error": f"db open failed: {exc}"}))
        return

    try:
        # ----- Resolve killswitch + aggressive once -----
        ks_raw = _config(conn, "EMERGENCY_KILLSWITCH")
        killswitch_on = (ks_raw or "").strip().lower() == "true"

        agg_raw = _config(conn, "AGGRESSIVE_THRESHOLD")
        if agg_raw is not None:
            try:
                aggressive_threshold = int(float(agg_raw))
            except (TypeError, ValueError):
                aggressive_threshold = None

        # ----- 1. Open positions (cross-system aggregate) -----
        try:
            row1 = conn.execute(
                "SELECT COUNT(*) FROM active_trades WHERE status='open'"
            ).fetchone()
            row2 = (
                conn.execute(
                    "SELECT COUNT(*) FROM auto_trades "
                    "WHERE status='open' AND trade_mode='live'"
                ).fetchone()
                if _has_table(conn, "auto_trades")
                else None
            )
            total = (row1[0] if row1 else 0) + (row2[0] if row2 else 0)
            if total > 0:
                noun = "positions" if total != 1 else "position"
                suggestions.append({
                    "id": "open_positions",
                    "label": f"Why are my {total} open {noun} sitting?",
                    "subtitle": f"{total} active · cross-system",
                    "icon": "TrendingUp",
                })
        except sqlite3.Error:
            pass

        # ----- 2. Last signal (trade_insights, NOT signals_log) -----
        try:
            if _has_table(conn, "trade_insights"):
                row = conn.execute(
                    "SELECT ticker, signal_type, confidence "
                    "FROM trade_insights "
                    "ORDER BY created_at DESC LIMIT 1"
                ).fetchone()
                if row:
                    ticker, signal_type, conf = row[0], row[1], row[2]
                    try:
                        conf_disp = int(round(float(conf) * 100)) if conf is not None and float(conf) <= 1.5 else int(round(float(conf or 0)))
                    except (TypeError, ValueError):
                        conf_disp = 0
                    s_type = (signal_type or "").upper()
                    direction = "LONG" if s_type.startswith("LONG") else "SHORT" if s_type.startswith("SHORT") else (s_type or "signal")
                    if direction in ("LONG", "SHORT"):
                        label = f"Should I act on the {ticker} {direction} at {conf_disp}?"
                    else:
                        label = f"What does the latest {ticker} {direction} signal mean?"
                    suggestions.append({
                        "id": "last_signal",
                        "label": label,
                        "subtitle": "last signal · confidence-aware",
                        "icon": "Activity",
                    })
        except sqlite3.Error:
            pass

        # ----- 3. Killswitch context (always one card here) -----
        if killswitch_on:
            suggestions.append({
                "id": "killswitch_engaged",
                "label": "Why is my killswitch on?",
                "subtitle": "execution suspended · positions held",
                "icon": "ShieldAlert",
            })
        else:
            suggestions.append({
                "id": "edge_check",
                "label": "What's my best edge right now?",
                "subtitle": "calibration + win-rate snapshot",
                "icon": "Target",
            })

        # ----- 4. Aggressive threshold (only if it's been pulled below default) -----
        # Default has historically been 35-40. We surface the prompt only when
        # the floor is genuinely tight (< 40) — otherwise the question is
        # uninformative. If the value is None (key missing) we silently skip.
        if aggressive_threshold is not None and aggressive_threshold < 40:
            suggestions.append({
                "id": "aggressive_check",
                "label": "How is my low confidence floor performing?",
                "subtitle": f"AGGRESSIVE_THRESHOLD = {aggressive_threshold}",
                "icon": "Flame",
            })

        # ----- 5. Calibration (unified_outcomes view, NOT closed_trades) -----
        try:
            if _has_table(conn, "unified_outcomes"):
                row = conn.execute(
                    "SELECT COUNT(*) FROM unified_outcomes "
                    "WHERE pnl_pct IS NOT NULL AND confidence IS NOT NULL"
                ).fetchone()
                n = int(row[0]) if row and row[0] is not None else 0
                if n >= 30:
                    suggestions.append({
                        "id": "calibration",
                        "label": "Walk me through my calibration buckets",
                        "subtitle": f"n={n} closed trades scored",
                        "icon": "BarChart3",
                    })
        except sqlite3.Error:
            pass

        # ----- 6. Recent journal entry (F2 trade_journal table) -----
        try:
            if _has_table(conn, "trade_journal"):
                row = conn.execute(
                    "SELECT trade_source, trade_id "
                    "FROM trade_journal "
                    "ORDER BY generated_at DESC LIMIT 1"
                ).fetchone()
                if row:
                    src = row[0] or "auto_trades"
                    src_short = src.split("_")[0] if src else "trade"
                    suggestions.append({
                        "id": "recent_journal",
                        "label": "Summarize my last journaled trade",
                        "subtitle": f"{src_short}#{row[1]}",
                        "icon": "BookOpen",
                    })
        except sqlite3.Error:
            pass
    finally:
        conn.close()

    # Cap at 6 — order is the priority ranking above.
    suggestions = suggestions[:6]

    print(json.dumps({
        "suggestions": suggestions,
        "context_snapshot_at": datetime.now(timezone.utc).isoformat(),
        "killswitch_enabled": killswitch_on,
        "aggressive_threshold": aggressive_threshold,
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"suggestions": [], "error": f"{type(exc).__name__}: {exc}"}))
        sys.exit(0)  # soft-fail; route emits the empty shape via parse
