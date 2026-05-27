#!/usr/bin/env python3
"""query_shadow_registry.py — D4 (Shadow page) backend.

GET /api/shadow/registry returns the full shadow-table inventory grouped
by function (Entry / Exit / Scoring / Risk / Data), with status
(ACTIVE / DORMANT / BROKEN) classified per the same rules
query_shadow_status.py uses (rows==0 + expected_active → BROKEN; rows==0
+ !expected_active → DORMANT; latest_write < 7d → ACTIVE; else DORMANT).

This script re-declares its own TABLE_DEFS (rather than importing from
query_shadow_status.py) so the two endpoints can evolve independently.
The existing Intel-tab grid keeps its own payload shape; this one is
function-grouped for D4 and lighter (no per-table key_stat helpers — the
Intel grid is the deep-dive surface).
"""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

DB = "/home/trevor/trevor/trevor.db"
STALE_DAYS = 7

# (table_name, display, function, ts_col, ts_kind, expected_active)
# function ∈ {"Entry", "Exit", "Scoring", "Risk", "Data"}
TABLE_DEFS: list[Tuple[str, str, str, str, str, bool]] = [
    # Entry (7)
    ("alo_entry_shadow",              "ALO Entries",                "Entry",   "created_at",      "iso",  True),
    ("per_ticker_cap_shadow",         "Per-Ticker Cap",             "Entry",   "ts",              "iso",  True),
    ("regime_gate_shadow",            "Regime Gate (V1)",           "Entry",   "ts",              "iso",  True),
    ("threshold_recalibration_shadow","Threshold Recalibration",    "Entry",   "timestamp",       "iso",  True),
    ("time_gate_shadow",              "Time Gate (P06)",            "Entry",   "ts",              "iso",  True),
    ("double_filter_shadow_v1",       "Double Filter (Guard+Gate)", "Entry",   "ts",              "iso",  True),
    ("regime_gate_v2_shadow",         "Regime Gate V2",             "Entry",   "created_at",      "iso",  False),
    # Exit (7)
    ("momentum_exit_shadow",          "Momentum Exit V2",           "Exit",    "cycle_timestamp", "iso",  True),
    ("gap_watchdog_shadow",           "Gap Watchdog",               "Exit",    "created_at",      "iso",  True),
    ("slippage_audit",                "Slippage Audit",             "Exit",    "created_at",      "iso",  True),
    ("funding_cost_shadow",           "Funding Cost",               "Exit",    "created_at",      "iso",  True),
    ("trail_v3_shadow",               "Trail V3",                   "Exit",    "created_at",      "iso",  True),
    ("partial_trigger_shadow",        "Partial Triggers",           "Exit",    "created_at",      "iso",  True),
    ("live_partial_shadow",           "Live Partials",              "Exit",    "created_at",      "iso",  False),
    ("exit_engine_shadow",            "Exit Engine",                "Exit",    "created_at",      "iso",  False),
    # Scoring (5)
    ("shadow_scoring",                "Shadow Scoring (HMM+DS)",    "Scoring", "timestamp",       "iso",  True),
    ("shadow_scorer_v2",              "Shadow Scorer V2 (A-F)",     "Scoring", "timestamp",       "iso",  True),
    ("calibrator_audit",              "Calibrator V1 Audit",        "Scoring", "timestamp",       "iso",  True),
    ("calibration_v2_audit",          "Calibrator V2 Audit",        "Scoring", "timestamp",       "iso",  True),
    ("group_weight_shadow",           "Group Weight",               "Scoring", "timestamp",       "iso",  False),
    # Risk (3)
    ("leverage_v2_shadow",            "Leverage V2",                "Risk",    "created_at",      "iso",  True),
    ("sizing_v2_shadow",              "Sizing V2",                  "Risk",    "created_at",      "iso",  True),
    ("stop_floor_v2_shadow",          "Stop Floor V2",              "Risk",    "created_at",      "iso",  False),
    # Data (2)
    ("meme_onchain_shadow_log",       "Meme On-Chain Log",          "Data",    "ts",              "unix", True),
    ("whale_source_shadow_log",       "Whale Source Log",           "Data",    "ts",              "unix", True),
]


def _parse_ts(s: str) -> datetime:
    raw = s.strip()
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f"):
            try:
                return datetime.strptime(raw, fmt)
            except ValueError:
                continue
        raise ValueError(f"unparseable ts: {s!r}")
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _classify(rows: int, latest_iso: Optional[str], expected_active: bool) -> str:
    if rows == 0:
        return "BROKEN" if expected_active else "DORMANT"
    if not latest_iso:
        return "DORMANT"
    try:
        now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
        age = now_utc - _parse_ts(latest_iso)
        return "ACTIVE" if age < timedelta(days=STALE_DAYS) else "DORMANT"
    except Exception:
        return "DORMANT"


def _inspect(
    conn: sqlite3.Connection,
    table: str,
    display: str,
    function: str,
    ts_col: str,
    ts_kind: str,
    expected_active: bool,
) -> dict:
    info: dict = {
        "table_name": table,
        "display": display,
        "function": function,
        "rows": 0,
        "rows_48h": 0,
        "latest_write": None,
        "status": "DORMANT",
        "expected_active": expected_active,
    }

    try:
        total_row = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()
    except sqlite3.OperationalError as exc:
        info["status"] = "BROKEN" if expected_active else "DORMANT"
        info["error"] = f"table missing: {exc}"
        return info

    info["rows"] = total_row[0] if total_row else 0

    try:
        if ts_kind == "unix":
            recent = conn.execute(
                f"SELECT COUNT(*) FROM {table} "
                f"WHERE {ts_col} > CAST(strftime('%s', 'now', '-2 days') AS INTEGER)"
            ).fetchone()[0]
            latest_unix = conn.execute(
                f"SELECT MAX({ts_col}) FROM {table}"
            ).fetchone()[0]
            if latest_unix is not None:
                latest_iso = datetime.fromtimestamp(int(latest_unix), tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            else:
                latest_iso = None
        else:
            recent = conn.execute(
                f"SELECT COUNT(*) FROM {table} "
                f"WHERE {ts_col} > datetime('now', '-2 days')"
            ).fetchone()[0]
            latest_iso = conn.execute(
                f"SELECT MAX({ts_col}) FROM {table}"
            ).fetchone()[0]
        info["rows_48h"] = recent or 0
        info["latest_write"] = latest_iso
    except Exception as exc:
        info["error"] = f"ts read: {type(exc).__name__}: {exc}"
        latest_iso = None

    info["status"] = _classify(info["rows"], latest_iso, expected_active)
    return info


def main() -> int:
    try:
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=5.0)
    except Exception as exc:
        print(json.dumps({
            "tables": [], "by_function": {}, "by_status": {},
            "total": 0,
            "error": f"{type(exc).__name__}: {exc}",
        }))
        return 0

    tables = []
    for tdef in TABLE_DEFS:
        tables.append(_inspect(conn, *tdef))
    conn.close()

    by_function: dict[str, list[str]] = {}
    by_status: dict[str, int] = {"ACTIVE": 0, "DORMANT": 0, "BROKEN": 0}
    for t in tables:
        fn = t["function"]
        by_function.setdefault(fn, []).append(t["table_name"])
        by_status[t["status"]] = by_status.get(t["status"], 0) + 1

    print(json.dumps({
        "tables": tables,
        "by_function": by_function,
        "by_status": by_status,
        "total": len(tables),
        "stale_days": STALE_DAYS,
    }, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
