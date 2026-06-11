#!/usr/bin/env python3
"""query_shadow_registry.py — Shadow page backend (D4 + SH-HUB 2026-06-11).

GET /api/shadow/registry returns the full shadow-table inventory grouped by
function (Entry / Exit / Scoring / Risk / Data / Other), each with:
  - rows, rows_48h, latest_write, status (ACTIVE / DORMANT / BROKEN)
  - divergent_n + divergence_pct      (when the table has a boolean divergence
                                        / would-fire column; else null)
  - promotion: ready | accruing | na  (n>=30 divergent samples AND a Wilson 95%
                                        lower-bound that excludes the no-divergence
                                        null → "ready"; <30 → "accruing"; no
                                        divergence column → "na")
plus a top-level replica freshness stamp (the WSL litestream replica refreshes
every ~15 min via trevor-restore.timer, so a glance knows the counts may lag).

DYNAMIC ENUMERATION (SH-HUB): the table set is read from sqlite_master
(`name LIKE '%shadow%'` ∪ a few curated non-"shadow"-named adjuncts), NOT a
hardcoded list — so the SHADOW-RM roadmap's new shadow tables appear
automatically with ZERO code change here. OVERRIDE below is a metadata map
(curated display / function / expected_active / retired) for known tables;
anything not in it is auto-derived (prettified name, name-keyword function
heuristic → "Other" fallback, best-available timestamp column).

READ-ONLY (`mode=ro`). Never writes the DB, never imports `hyperliquid`.
"""
from __future__ import annotations

import json
import math
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from typing import Optional

DB = "/home/trevor/trevor/trevor.db"  # symlink → /home/ghost/trevor-replica/trevor.db on WSL
STALE_DAYS = 7
PROMOTION_MIN_N = 30  # divergent samples needed before a Wilson test is meaningful

# Curated metadata for known tables. Anything NOT here is auto-derived.
# fields: display, function, ts_col, ts_kind, expected_active, retired
# function ∈ {"Entry", "Exit", "Scoring", "Risk", "Data", "Other"}
OVERRIDE: dict[str, dict] = {
    # ── Entry ────────────────────────────────────────────────────────────────
    "alo_entry_shadow":               dict(display="ALO Entries",                function="Entry",   ts_col="created_at",      ts_kind="iso",  expected_active=True),
    "per_ticker_cap_shadow":          dict(display="Per-Ticker Cap",             function="Entry",   ts_col="ts",              ts_kind="iso",  expected_active=True),
    "regime_gate_shadow":             dict(display="Regime Gate (V1)",           function="Entry",   ts_col="ts",              ts_kind="iso",  expected_active=True),
    "threshold_recalibration_shadow": dict(display="Threshold Recalibration",    function="Entry",   ts_col="timestamp",       ts_kind="iso",  expected_active=True),
    "time_gate_shadow":               dict(display="Time Gate (P06)",            function="Entry",   ts_col="ts",              ts_kind="iso",  expected_active=True),
    "double_filter_shadow_v1":        dict(display="Double Filter (Guard+Gate)", function="Entry",   ts_col="ts",              ts_kind="iso",  expected_active=True),
    "regime_gate_v2_shadow":          dict(display="Regime Gate V2",             function="Entry",   ts_col="created_at",      ts_kind="iso",  expected_active=False),
    "exhaustion_entry_shadow":        dict(display="Exhaustion Entry (S3-P04)",  function="Entry",   ts_col="created_at",      ts_kind="iso",  expected_active=True),
    "orderflow_entry_shadow":         dict(display="Orderflow Entry (RETIRED)",  function="Entry",   ts_col="created_at",      ts_kind="iso",  expected_active=False, retired=True),
    "trend_floor_shadow":             dict(display="Trend Floor",                function="Entry",   ts_col="ts",              ts_kind="iso",  expected_active=True),
    "cooldown_suppression_shadow":    dict(display="Cooldown Suppression (P08)", function="Entry",   ts_col="ts",              ts_kind="iso",  expected_active=True),
    # ── Exit ─────────────────────────────────────────────────────────────────
    "regime_exit_shadow":             dict(display="Regime-Aware Exits (S2-P04)", function="Exit",   ts_col="created_at",      ts_kind="iso",  expected_active=False),
    "momentum_exit_shadow":           dict(display="Momentum Exit V2",           function="Exit",    ts_col="cycle_timestamp", ts_kind="iso",  expected_active=True),
    "gap_watchdog_shadow":            dict(display="Gap Watchdog",               function="Exit",    ts_col="created_at",      ts_kind="iso",  expected_active=True),
    "slippage_audit":                 dict(display="Slippage Audit",             function="Exit",    ts_col="created_at",      ts_kind="iso",  expected_active=True),
    "funding_cost_shadow":            dict(display="Funding Cost",               function="Exit",    ts_col="created_at",      ts_kind="iso",  expected_active=True),
    "trail_v3_shadow":                dict(display="Trail V3",                   function="Exit",    ts_col="created_at",      ts_kind="iso",  expected_active=True),
    "partial_trigger_shadow":         dict(display="Partial Triggers",           function="Exit",    ts_col="created_at",      ts_kind="iso",  expected_active=True),
    "live_partial_shadow":            dict(display="Live Partials",              function="Exit",    ts_col="created_at",      ts_kind="iso",  expected_active=False),
    "cvd_oi_exit_shadow":             dict(display="CVD/OI Exit (S3-P02)",       function="Exit",    ts_col="created_at",      ts_kind="iso",  expected_active=True),
    "reversal_exit_shadow":           dict(display="Reversal Exit (S3-P03)",     function="Exit",    ts_col="created_at",      ts_kind="iso",  expected_active=True),
    "session_exit_shadow":            dict(display="Session/Time Exit (S3-P06)", function="Exit",    ts_col="created_at",      ts_kind="iso",  expected_active=True),
    "exit_engine_shadow":             dict(display="Exit Engine (RETIRED)",      function="Exit",    ts_col="created_at",      ts_kind="iso",  expected_active=False, retired=True),
    # ── Scoring ──────────────────────────────────────────────────────────────
    "shadow_scoring":                 dict(display="Shadow Scoring (HMM+DS)",    function="Scoring", ts_col="timestamp",       ts_kind="iso",  expected_active=True),
    "shadow_scorer_v2":               dict(display="Shadow Scorer V2 (A-F)",     function="Scoring", ts_col="timestamp",       ts_kind="iso",  expected_active=True),
    "calibrator_audit":               dict(display="Calibrator V1 Audit",        function="Scoring", ts_col="timestamp",       ts_kind="iso",  expected_active=True),
    "calibration_v2_audit":           dict(display="Calibrator V2 Audit",        function="Scoring", ts_col="timestamp",       ts_kind="iso",  expected_active=True),
    "group_weight_shadow":            dict(display="Group Weight",               function="Scoring", ts_col="timestamp",       ts_kind="iso",  expected_active=False),
    # ── Risk ─────────────────────────────────────────────────────────────────
    "sizing_v2_shadow":               dict(display="Sizing V2",                  function="Risk",    ts_col="created_at",      ts_kind="iso",  expected_active=True),
    "stop_floor_v2_shadow":           dict(display="Stop Floor V2",              function="Risk",    ts_col="created_at",      ts_kind="iso",  expected_active=False),
    "leverage_v2_shadow":             dict(display="Leverage V2 (RETIRED)",      function="Risk",    ts_col="created_at",      ts_kind="iso",  expected_active=False, retired=True),
    # ── Data ─────────────────────────────────────────────────────────────────
    "meme_onchain_shadow_log":        dict(display="Meme On-Chain Log",          function="Data",    ts_col="ts",              ts_kind="unix", expected_active=True),
    "whale_source_shadow_log":        dict(display="Whale Source Log (RETIRED)",  function="Data",    ts_col="ts",              ts_kind="unix", expected_active=False, retired=True),
    "funding_signal_shadow":          dict(display="Funding Signal (S3-P01)",    function="Data",    ts_col="created_at",      ts_kind="iso",  expected_active=False),
}

# Non-"shadow"-named adjuncts to fold into the enumeration (LIKE '%shadow%' misses them).
EXTRA_TABLES = ["slippage_audit", "calibrator_audit", "calibration_v2_audit"]

# Timestamp column preference for auto-derived (non-override) tables.
TS_PRIORITY = ["created_at", "ts", "timestamp", "cycle_timestamp", "time"]

# Boolean divergence / would-fire column preference (first present wins).
DIV_PRIORITY = ["divergent", "would_block", "would_fire", "would_fire_v1", "is_divergent"]

# Ordered (substring, function) heuristic for auto-derived tables. First match wins,
# so Exit/Risk/Scoring/Data specifics are checked before the generic Entry terms.
FUNCTION_HEURISTIC: list[tuple[str, str]] = [
    ("attribution", "Exit"), ("reversal", "Exit"), ("session", "Exit"),
    ("momentum", "Exit"), ("trail", "Exit"), ("gap", "Exit"),
    ("partial", "Exit"), ("slippage", "Exit"), ("funding_cost", "Exit"),
    ("exit", "Exit"),
    ("calibrat", "Scoring"), ("group_weight", "Scoring"), ("scor", "Scoring"),
    ("leverage", "Risk"), ("sizing", "Risk"), ("risk", "Risk"),
    ("hard_stop", "Risk"), ("stop", "Risk"), ("_cap", "Risk"), ("budget", "Risk"),
    ("meme", "Data"), ("whale", "Data"), ("onchain", "Data"), ("funding_signal", "Data"),
    ("entry", "Entry"), ("gate", "Entry"), ("threshold", "Entry"),
    ("cooldown", "Entry"), ("orderflow", "Entry"), ("exhaustion", "Entry"),
    ("counter_trend", "Entry"), ("trend", "Entry"), ("direction", "Entry"),
    ("penalty", "Entry"), ("scan", "Entry"), ("cadence", "Entry"),
    ("timing", "Entry"), ("execution", "Entry"),
]


def _prettify(table: str) -> str:
    base = table
    for suf in ("_shadow_log", "_shadow", "_log", "_audit"):
        if base.endswith(suf):
            base = base[: -len(suf)]
            break
    return " ".join(w.capitalize() for w in base.split("_")) or table


def _heuristic_function(table: str) -> str:
    low = table.lower()
    for needle, fn in FUNCTION_HEURISTIC:
        if needle in low:
            return fn
    return "Other"


def _wilson_lb(k: int, n: int, z: float = 1.96) -> float:
    """Wilson score-interval lower bound for k successes in n trials (95% default)."""
    if n <= 0:
        return 0.0
    p = k / n
    denom = 1.0 + z * z / n
    centre = p + z * z / (2.0 * n)
    margin = z * math.sqrt((p * (1.0 - p) + z * z / (4.0 * n)) / n)
    return max(0.0, (centre - margin) / denom)


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


def _columns(conn: sqlite3.Connection, table: str) -> dict[str, str]:
    """name → declared type (upper) for the table's columns."""
    out: dict[str, str] = {}
    for r in conn.execute(f"PRAGMA table_info({table})"):
        out[r["name"]] = (r["type"] or "").upper()
    return out


def _pick_ts(cols: dict[str, str]) -> tuple[Optional[str], str]:
    for c in TS_PRIORITY:
        if c in cols:
            kind = "unix" if "INT" in cols[c] else "iso"
            return c, kind
    return None, "iso"


def _pick_div(cols: dict[str, str]) -> Optional[str]:
    for c in DIV_PRIORITY:
        if c in cols:
            return c
    return None


def _inspect(conn: sqlite3.Connection, table: str) -> dict:
    ov = OVERRIDE.get(table, {})
    cols = _columns(conn, table)

    function = ov.get("function") or _heuristic_function(table)
    display = ov.get("display") or _prettify(table)
    expected_active = ov.get("expected_active")
    retired = bool(ov.get("retired", False))

    # timestamp column: override if given (and present), else auto-pick.
    ts_col = ov.get("ts_col") if ov.get("ts_col") in cols else None
    ts_kind = ov.get("ts_kind", "iso")
    if ts_col is None:
        ts_col, ts_kind = _pick_ts(cols)

    info: dict = {
        "table_name": table,
        "display": display,
        "function": function,
        "rows": 0,
        "rows_48h": 0,
        "latest_write": None,
        "status": "DORMANT",
        "expected_active": bool(expected_active) if expected_active is not None else False,
        "retired": retired,
        "auto_derived": table not in OVERRIDE,
        "divergence_col": None,
        "divergent_n": None,
        "divergence_pct": None,
        "promotion": "na",
        "promotion_n": None,
    }

    try:
        total = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    except sqlite3.OperationalError as exc:
        info["status"] = "BROKEN" if info["expected_active"] else "DORMANT"
        info["error"] = f"table missing: {exc}"
        return info
    info["rows"] = total or 0

    # Unknown tables: default expected_active False (a 0-row new table reads
    # DORMANT, not a false BROKEN alarm). Known tables keep their curated value.
    if expected_active is None:
        info["expected_active"] = False

    # 48h count + latest write
    latest_iso: Optional[str] = None
    if ts_col:
        try:
            if ts_kind == "unix":
                info["rows_48h"] = conn.execute(
                    f"SELECT COUNT(*) FROM {table} "
                    f"WHERE {ts_col} > CAST(strftime('%s','now','-2 days') AS INTEGER)"
                ).fetchone()[0] or 0
                mx = conn.execute(f"SELECT MAX({ts_col}) FROM {table}").fetchone()[0]
                if mx is not None:
                    latest_iso = datetime.fromtimestamp(int(mx), tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            else:
                info["rows_48h"] = conn.execute(
                    f"SELECT COUNT(*) FROM {table} "
                    f"WHERE {ts_col} > datetime('now','-2 days')"
                ).fetchone()[0] or 0
                latest_iso = conn.execute(f"SELECT MAX({ts_col}) FROM {table}").fetchone()[0]
            info["latest_write"] = latest_iso
        except Exception as exc:
            info["error"] = f"ts read: {type(exc).__name__}: {exc}"

    info["status"] = _classify(info["rows"], latest_iso, info["expected_active"])

    # Divergence + promotion-readiness (only when a boolean divergence column exists)
    div_col = _pick_div(cols)
    if div_col and total:
        try:
            n_div = conn.execute(
                f"SELECT COUNT(*) FROM {table} WHERE {div_col} = 1"
            ).fetchone()[0] or 0
            info["divergence_col"] = div_col
            info["divergent_n"] = n_div
            info["divergence_pct"] = round(100.0 * n_div / total, 1)
            info["promotion_n"] = n_div
            if n_div < PROMOTION_MIN_N:
                info["promotion"] = "accruing"
            else:
                # ready ⇔ enough divergent samples AND Wilson 95% LB excludes the
                # no-divergence null (LB of the divergence rate > 0).
                info["promotion"] = "ready" if _wilson_lb(n_div, total) > 0.0 else "accruing"
        except Exception as exc:
            info["error"] = (info.get("error") or "") + f" | div: {exc}"

    return info


def _enumerate(conn: sqlite3.Connection) -> list[str]:
    names = [
        r["name"]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%shadow%' "
            "ORDER BY name"
        )
    ]
    have = set(names)
    for extra in EXTRA_TABLES:
        if extra not in have:
            exists = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (extra,)
            ).fetchone()
            if exists:
                names.append(extra)
    return sorted(names)


def _replica_age() -> tuple[Optional[int], Optional[str]]:
    """Replica freshness from the published-file mtime (atomic-mv restore stamp)."""
    try:
        target = os.path.realpath(DB)
        st = os.stat(target)
        age = int(datetime.now(timezone.utc).timestamp() - st.st_mtime)
        iso = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        return max(0, age), iso
    except Exception:
        return None, None


def main() -> int:
    age, mtime = _replica_age()
    try:
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=8.0)
        conn.row_factory = sqlite3.Row
    except Exception as exc:
        print(json.dumps({
            "tables": [], "by_function": {}, "by_status": {},
            "total": 0, "stale_days": STALE_DAYS,
            "replica_age_seconds": age, "replica_mtime": mtime,
            "error": f"{type(exc).__name__}: {exc}",
        }))
        return 0

    tables = [_inspect(conn, t) for t in _enumerate(conn)]
    conn.close()

    by_function: dict[str, list[str]] = {}
    by_status: dict[str, int] = {"ACTIVE": 0, "DORMANT": 0, "BROKEN": 0}
    promotion_ready = 0
    for t in tables:
        by_function.setdefault(t["function"], []).append(t["table_name"])
        by_status[t["status"]] = by_status.get(t["status"], 0) + 1
        if t.get("promotion") == "ready":
            promotion_ready += 1

    print(json.dumps({
        "tables": tables,
        "by_function": by_function,
        "by_status": by_status,
        "total": len(tables),
        "promotion_ready": promotion_ready,
        "stale_days": STALE_DAYS,
        "promotion_min_n": PROMOTION_MIN_N,
        "replica_age_seconds": age,
        "replica_mtime": mtime,
    }, default=str))
    return 0


if __name__ == "__main__":
    # OUTER-WRAP: silent-crash visibility
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
