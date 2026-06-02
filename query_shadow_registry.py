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
    # Entry (11)
    ("alo_entry_shadow",              "ALO Entries",                "Entry",   "created_at",      "iso",  True),
    ("per_ticker_cap_shadow",         "Per-Ticker Cap",             "Entry",   "ts",              "iso",  True),
    ("regime_gate_shadow",            "Regime Gate (V1)",           "Entry",   "ts",              "iso",  True),
    ("threshold_recalibration_shadow","Threshold Recalibration",    "Entry",   "timestamp",       "iso",  True),
    ("time_gate_shadow",              "Time Gate (P06)",            "Entry",   "ts",              "iso",  True),
    ("double_filter_shadow_v1",       "Double Filter (Guard+Gate)", "Entry",   "ts",              "iso",  True),
    ("regime_gate_v2_shadow",         "Regime Gate V2",             "Entry",   "created_at",      "iso",  False),
    ("exhaustion_entry_shadow",       "Exhaustion Entry (S3-P04)",  "Entry",   "created_at",      "iso",  True),
    # RETIRED 2026-06-01 (TRIAGE-whale-meme-entry): writer flag-gated OFF
    # (ORDERFLOW_ENTRY_SHADOW_ENABLED=false). 4 frozen rows, no consumer.
    # expected_active=False so a future drop-to-0 reads DORMANT, not BROKEN.
    ("orderflow_entry_shadow",        "Orderflow Entry (RETIRED)",  "Entry",   "created_at",      "iso",  False),
    ("trend_floor_shadow",            "Trend Floor",                "Entry",   "ts",              "iso",  True),
    # P08 (Wave D ADD): entry-side cooldown-suppression telemetry by subtype (dedup/sqlite/guard). Canonical ts col.
    ("cooldown_suppression_shadow",   "Cooldown Suppression (P08)", "Entry",   "ts",              "iso",  True),
    # Exit (11) — exit_engine_shadow RETIRED 2026-06-01 (P06), see RETIRED_TABLE_DEFS
    ("regime_exit_shadow",            "Regime-Aware Exits (S2-P04)", "Exit",    "created_at",      "iso",  False),
    ("momentum_exit_shadow",          "Momentum Exit V2",           "Exit",    "cycle_timestamp", "iso",  True),
    ("gap_watchdog_shadow",           "Gap Watchdog",               "Exit",    "created_at",      "iso",  True),
    ("slippage_audit",                "Slippage Audit",             "Exit",    "created_at",      "iso",  True),
    ("funding_cost_shadow",           "Funding Cost",               "Exit",    "created_at",      "iso",  True),
    ("trail_v3_shadow",               "Trail V3",                   "Exit",    "created_at",      "iso",  True),
    ("partial_trigger_shadow",        "Partial Triggers",           "Exit",    "created_at",      "iso",  True),
    ("live_partial_shadow",           "Live Partials",              "Exit",    "created_at",      "iso",  False),
    ("cvd_oi_exit_shadow",            "CVD/OI Exit (S3-P02)",       "Exit",    "created_at",      "iso",  True),
    ("reversal_exit_shadow",          "Reversal Exit (S3-P03)",     "Exit",    "created_at",      "iso",  True),
    ("session_exit_shadow",           "Session/Time Exit (S3-P06)", "Exit",    "created_at",      "iso",  True),
    # Scoring (5)
    ("shadow_scoring",                "Shadow Scoring (HMM+DS)",    "Scoring", "timestamp",       "iso",  True),
    ("shadow_scorer_v2",              "Shadow Scorer V2 (A-F)",     "Scoring", "timestamp",       "iso",  True),
    ("calibrator_audit",              "Calibrator V1 Audit",        "Scoring", "timestamp",       "iso",  True),
    ("calibration_v2_audit",          "Calibrator V2 Audit",        "Scoring", "timestamp",       "iso",  True),
    ("group_weight_shadow",           "Group Weight",               "Scoring", "timestamp",       "iso",  False),
    # Risk (2) — leverage_v2_shadow RETIRED 2026-06-01 (P06), see RETIRED_TABLE_DEFS
    ("sizing_v2_shadow",              "Sizing V2",                  "Risk",    "created_at",      "iso",  True),
    ("stop_floor_v2_shadow",          "Stop Floor V2",              "Risk",    "created_at",      "iso",  False),
    # Data (3)
    ("meme_onchain_shadow_log",       "Meme On-Chain Log",          "Data",    "ts",              "unix", True),
    # RETIRED 2026-06-01 (TRIAGE-whale-meme-entry): writer flag-gated OFF
    # (WHALE_SOURCE_SHADOW_ENABLED=false). MoonDev source dead, 1:1 mirror of
    # hl_bias (0% divergence). expected_active=False so a future drop-to-0
    # reads DORMANT, not BROKEN. Rows retained.
    ("whale_source_shadow_log",       "Whale Source Log (RETIRED)", "Data",    "ts",              "unix", False),
    ("funding_signal_shadow",         "Funding Signal (S3-P01)",    "Data",    "created_at",      "iso",  False),
]

# ── RETIRED shadows (2026-06-01, P06 CUT-leverage-exitengine) ────────────────
# These two shadow tables were deregistered from the live registry roll-up
# (removed from TABLE_DEFS above) because their writers are now suppressed
# flag-OFF in the bot repo (LEVERAGE_V2_SHADOW_ENABLED / EXIT_ENGINE_SHADOW_ENABLED,
# both default false). The tables + historical rows are RETAINED (additive-DB
# law) — Ghost may archive manually later. Kept here in-source (NOT iterated
# into the output) so the registry history stays explicit:
#
#   leverage_v2_shadow — 105 rows. 0% divergence, structurally can never disagree
#     (hard-wired fixed_5x vs fixed-5x production). Was Risk, expected_active=True
#     (a deliberate retirement, not a drop-to-0 alarm — reverses the 2026-06-01
#     REG-six-shadows "should alarm" stance for THESE two only).
#   exit_engine_shadow — 8 rows. Frozen redundant rollup; axis GLOBAL_DEFAULTS vs
#     per-ticker exit PROFILE, inert with PER_TICKER_EXIT_PROFILES=false. Was Exit,
#     expected_active=False. Decision-space now covered by the granular exit shadows
#     (regime_exit / momentum_exit / …) + future exit_attribution_shadow (Wave D ADD-02).
#
# To un-retire: move the tuple back into TABLE_DEFS and re-enable the bot-side flag.
RETIRED_TABLE_DEFS: list[Tuple[str, str, str, str, str, bool]] = [
    ("leverage_v2_shadow",            "Leverage V2 (retired)",      "Risk",    "created_at",      "iso",  False),
    ("exit_engine_shadow",            "Exit Engine (retired)",      "Exit",    "created_at",      "iso",  False),
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
    # OUTER-WRAP: 2026-05-27 (silent-crash visibility)
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        sys.exit(main())

    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
