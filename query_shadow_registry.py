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
import statistics
import sys
from datetime import datetime, timedelta, timezone
from typing import Optional

DB = "/home/trevor/trevor/trevor.db"  # symlink → /home/ghost/trevor-replica/trevor.db on WSL
STALE_DAYS = 7
PROMOTION_MIN_N = 30  # divergent samples needed before a Wilson test is meaningful

# ── Stale-when-expected alarm (B2) ───────────────────────────────────────────
# A shadow registered expected_active=True that still has rows but has gone
# silent beyond its OWN historical write cadence is STALE — a distinct alarm,
# NOT silently demoted to DORMANT (the by-design state of expected_active=False
# tables). Under the old rows==0-only alarm, regime_gate_shadow read DORMANT for
# ~20 days with rows>0 and nobody noticed. The cadence is data-driven per table
# (median inter-write gap), never hardcoded per-table.
STALE_ALARM_ENABLED = True       # default-OFF→ON after the gate proved before/after on regime_gate_shadow
STALE_GAP_SAMPLE = 500           # last N inter-write gaps sampled (wide enough to see inter-burst gaps)
STALE_FACTOR = 12                # alarm once silent for FACTOR × the MEDIAN gap (steady-cadence tables)
STALE_MAXGAP_FACTOR = 2          # ...OR FACTOR × the table's longest-ever gap (activity-driven/bursty tables)
STALE_MIN_FLOOR_SEC = 6 * 3600   # floor — absorbs WSL replica lag (~15-30m)
STALE_MAX_THRESHOLD_SEC = 21 * 86400  # cap — a freak historical outage can't mask a real death past 21d

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
    "signal_ab_results":              dict(display="Signal A/B Results",         function="Scoring", ts_col="created_at",      ts_kind="iso",  expected_active=True),
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
# signal_ab_results (B2): 2k+ rows, writing live every signal, but invisible — no
# "shadow" in the name and not previously enumerated. Surfaced in the curated extras.
EXTRA_TABLES = ["slippage_audit", "calibrator_audit", "calibration_v2_audit", "signal_ab_results"]

# Deregistered dead shadows (B1, 2026-06-20) — excluded from the Hub roll-up.
# The enumerator matches LIKE '%shadow%', so OVERRIDE retired=True only RELABELS;
# this exclude-set is what actually HIDES a dead observer. Tables + historical
# rows stay on disk (additive-DB law — no DROP); reverse by removing a name here.
# NB: orderflow/exit_engine/leverage_v2/whale writers are flag-OFF; regime_gate_shadow
# (v1) + group_weight_shadow have NO private flag (shared with the LIVE v2 scorers)
# → deregister-ONLY, flip nothing. The LIVE regime_gate_v2_shadow is NOT listed here.
DEREGISTERED: frozenset[str] = frozenset({
    "orderflow_entry_shadow",
    "exit_engine_shadow",
    "leverage_v2_shadow",
    "whale_source_shadow_log",
    "regime_gate_shadow",
    "group_weight_shadow",
})

# Timestamp column preference for auto-derived (non-override) tables.
TS_PRIORITY = ["created_at", "ts", "timestamp", "cycle_timestamp", "time"]

# Boolean divergence / would-fire column preference (first present wins).
# would_fire_v1 deliberately EXCLUDED (B2): live_partial_shadow's would_fire_v1 is
# a hardcoded-True stub (never wired to a real v1 partial-fire decision), so it
# falsely reads 100% would-fire → promotion-ready. The real fix sets it NULL
# VM-side; here we de-rank it so a stub column never feeds the promotion signal.
DIV_PRIORITY = ["divergent", "would_block", "would_fire", "is_divergent"]
# Realized per-trade outcome columns, in preference order. When a table carries
# one of these AND it is linked (NOT NULL), HUB-C2 surfaces read-only aggregate
# stats (mean / min / max / win-rate over linked rows). A would-fire/divergence
# boolean is NOT an outcome — divergence_pct must never be relabelled a win-rate.
OUTCOME_PRIORITY = ["realized_pnl_usd", "actual_pnl_usd"]

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


def _cadence(
    conn: sqlite3.Connection, table: str, ts_col: str, ts_kind: str
) -> Optional[tuple[float, float]]:
    """(median_gap, max_gap) in seconds from the last STALE_GAP_SAMPLE+1 rows.

    Generic, data-driven cadence — never hardcoded per-table. max_gap = the
    longest the table has EVER been quiet in the sample (so an activity-driven /
    bursty writer isn't false-flagged during a normal lull). None when there are
    too few parseable timestamps.
    """
    try:
        rows = conn.execute(
            f"SELECT {ts_col} FROM {table} ORDER BY {ts_col} DESC LIMIT {STALE_GAP_SAMPLE + 1}"
        ).fetchall()
    except Exception:
        return None
    ts: list[datetime] = []
    for r in rows:
        v = r[0]
        if v is None:
            continue
        try:
            if ts_kind == "unix":
                ts.append(datetime.fromtimestamp(int(v), tz=timezone.utc).replace(tzinfo=None))
            else:
                ts.append(_parse_ts(str(v)))
        except Exception:
            continue
    if len(ts) < 3:  # need ≥2 gaps for a meaningful cadence
        return None
    ts.sort()
    gaps = [(ts[i + 1] - ts[i]).total_seconds() for i in range(len(ts) - 1)]
    return statistics.median(gaps), max(gaps)


def _stale_threshold_sec(median_gap: float, max_gap: float) -> float:
    """Silence threshold from a table's own cadence: alarm once it has been quiet
    longer than it normally ever is. max(FACTOR×median, MAXGAP_FACTOR×longest-gap,
    floor), capped so a freak historical outage can't mask a real death forever.
    """
    thr = max(
        STALE_FACTOR * median_gap,
        STALE_MAXGAP_FACTOR * max_gap,
        STALE_MIN_FLOOR_SEC,
    )
    return min(thr, STALE_MAX_THRESHOLD_SEC)


def _classify(
    rows: int,
    latest_iso: Optional[str],
    expected_active: bool,
    stale_threshold_sec: Optional[float] = None,
) -> str:
    if rows == 0:
        return "BROKEN" if expected_active else "DORMANT"
    if not latest_iso:
        return "DORMANT"
    try:
        now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
        age = now_utc - _parse_ts(latest_iso)
    except Exception:
        return "DORMANT"
    # B2 stale-when-expected: an expected_active table silent beyond its own
    # historical cadence is STALE (an alarm), NOT silently demoted to DORMANT.
    if (
        STALE_ALARM_ENABLED
        and expected_active
        and stale_threshold_sec is not None
        and age.total_seconds() > stale_threshold_sec
    ):
        return "STALE"
    return "ACTIVE" if age < timedelta(days=STALE_DAYS) else "DORMANT"


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


def _pick_outcome(cols: dict[str, str]) -> Optional[str]:
    for c in OUTCOME_PRIORITY:
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
        # B2 stale-when-expected telemetry (null unless expected_active + rows + ts).
        "median_gap_sec": None,
        "max_gap_sec": None,
        "stale_threshold_sec": None,
        "silence_sec": None,
        "divergence_col": None,
        "divergent_n": None,
        "divergence_pct": None,
        "promotion": "na",
        "promotion_n": None,
        # Realized-outcome aggregates (HUB-C2) — null when the table has no
        # realized P&L column (Group C: count-only / "no per-trade outcome").
        "outcome_col": None,
        "outcome_linked_n": None,
        "outcome_mean_pnl": None,
        "outcome_min_pnl": None,
        "outcome_max_pnl": None,
        "outcome_win_rate": None,
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

    # B2 stale-when-expected: derive the per-table cadence threshold (data-driven)
    # and the current silence, for expected_active tables with rows + a ts column.
    stale_threshold_sec: Optional[float] = None
    if STALE_ALARM_ENABLED and info["expected_active"] and total and ts_col:
        cad = _cadence(conn, table, ts_col, ts_kind)
        if cad is not None:
            med, mx = cad
            stale_threshold_sec = _stale_threshold_sec(med, mx)
            info["median_gap_sec"] = round(med, 1)
            info["max_gap_sec"] = round(mx, 1)
        else:
            # too few rows to derive a cadence → fall back to the 7-day ceiling
            stale_threshold_sec = float(STALE_DAYS * 86400)
        info["stale_threshold_sec"] = round(stale_threshold_sec, 1)
    if latest_iso:
        try:
            now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
            info["silence_sec"] = round((now_utc - _parse_ts(latest_iso)).total_seconds(), 1)
        except Exception:
            pass

    info["status"] = _classify(info["rows"], latest_iso, info["expected_active"], stale_threshold_sec)

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

    # Realized-outcome aggregation (HUB-C2) — READ-ONLY over an EXISTING column,
    # pure SELECT (AVG/MIN/MAX/COUNT), no write/schema/persisted field. Computed
    # over LINKED (NOT NULL) rows only, with linked-n surfaced, so a partly-
    # linked table reports an honest sample size rather than a silent full-count
    # win-rate. WR = share of linked rows with realized P&L > 0.
    out_col = _pick_outcome(cols)
    if out_col and total:
        try:
            r = conn.execute(
                f"SELECT COUNT({out_col}) AS linked, "
                f"SUM(CASE WHEN {out_col} > 0 THEN 1 ELSE 0 END) AS wins, "
                f"AVG({out_col}) AS mean_pnl, "
                f"MIN({out_col}) AS lo, MAX({out_col}) AS hi "
                f"FROM {table} WHERE {out_col} IS NOT NULL"
            ).fetchone()
            linked = int(r["linked"] or 0)
            info["outcome_col"] = out_col
            info["outcome_linked_n"] = linked
            if linked > 0:
                info["outcome_mean_pnl"] = round(float(r["mean_pnl"]), 2)
                info["outcome_min_pnl"] = round(float(r["lo"]), 2)
                info["outcome_max_pnl"] = round(float(r["hi"]), 2)
                info["outcome_win_rate"] = round(100.0 * int(r["wins"] or 0) / linked, 1)
        except Exception as exc:
            info["error"] = (info.get("error") or "") + f" | outcome: {exc}"

    return info


# ── B6 unified shadow registry (registered_shadows) ──────────────────────────
# The B6 wave introduces a UNIFIED registry: one row per registered shadow in
# `shadow_registry`, with every observation logged to the single
# `shadow_observations` table (keyed by shadow_key). This is ADDITIVE to the
# legacy per-table inventory above — the Intel shadow-overview ignores the new
# top-level `registered_shadows` key; the Health <ShadowLabCard> consumes it.
#
# READ-ONLY. Both tables exist (B6) but are EMPTY until B7 registers the first
# shadow (ssl.py) — so today this returns [] and the card shows its empty-state.

def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).fetchone()
        is not None
    )


def _classify_registered(obs_total: int, latest_iso: Optional[str]) -> str:
    """Activity status for a REGISTERED shadow, derived from its observations.

    Deliberately NEVER returns BROKEN even for an expected_active shadow: a
    freshly-registered shadow has 0 observations, but that's PENDING-first-write
    — NOT an alarm — so 0 obs reads DORMANT (pending), never a false red on a
    brand-new registration (e.g. B7's ssl.py the moment it lands). (The STALE
    cadence alarm is a legacy per-table concept; the unified path stays simple.)
    """
    if obs_total == 0 or not latest_iso:
        return "DORMANT"
    try:
        now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
        age = now_utc - _parse_ts(latest_iso)
    except Exception:
        return "DORMANT"
    return "ACTIVE" if age < timedelta(days=STALE_DAYS) else "DORMANT"


def _registered_shadows(conn: sqlite3.Connection) -> list[dict]:
    """Fold `shadow_registry` rows with per-shadow observation aggregates from
    `shadow_observations`. One object per registered shadow: registry metadata
    (display/category/candidate/flags/min_n/parsed verdict) + obs counts +
    divergence + Wilson promotion-readiness + realized-outcome aggregate.

    READ-ONLY; pure SELECT. Returns [] when the registry table is absent (old
    replica) or empty (pre-B7).
    """
    if not _table_exists(conn, "shadow_registry"):
        return []
    have_obs = _table_exists(conn, "shadow_observations")
    try:
        reg_rows = conn.execute(
            "SELECT shadow_key, display_name, category, candidate_desc, obs_table, "
            "shadow_flag, promote_flag, min_n, status, expected_active, "
            "verdict_json, created_at, promoted_at, notes "
            "FROM shadow_registry ORDER BY category, shadow_key"
        ).fetchall()
    except sqlite3.OperationalError:
        return []

    out: list[dict] = []
    for r in reg_rows:
        key = r["shadow_key"]
        expected_active = (
            bool(r["expected_active"]) if r["expected_active"] is not None else False
        )
        min_n = int(r["min_n"]) if r["min_n"] is not None else PROMOTION_MIN_N
        verdict = None
        if r["verdict_json"]:
            try:
                verdict = json.loads(r["verdict_json"])
            except (ValueError, TypeError):
                verdict = None

        info: dict = {
            "shadow_key": key,
            "display": r["display_name"] or _prettify(key),
            "category": r["category"] or "Other",
            "candidate_desc": r["candidate_desc"],
            "obs_table": r["obs_table"] or "shadow_observations",
            "shadow_flag": r["shadow_flag"],
            "promote_flag": r["promote_flag"],
            "min_n": min_n,
            "registry_status": r["status"],
            "expected_active": expected_active,
            "created_at": r["created_at"],
            "promoted_at": r["promoted_at"],
            "notes": r["notes"],
            "verdict": verdict,
            "obs_total": 0,
            "obs_48h": 0,
            "latest_obs": None,
            "divergent_n": 0,
            "divergence_pct": None,
            "promotion": "na",
            "promotion_n": 0,
            "outcome_linked_n": 0,
            "outcome_mean_pnl": None,
            "outcome_min_pnl": None,
            "outcome_max_pnl": None,
            "outcome_win_rate": None,
            "status": "DORMANT",
        }

        if have_obs:
            try:
                agg = conn.execute(
                    "SELECT COUNT(*) AS total, "
                    "SUM(CASE WHEN divergent = 1 THEN 1 ELSE 0 END) AS div_n, "
                    "MAX(created_at) AS latest "
                    "FROM shadow_observations WHERE shadow_key = ?",
                    (key,),
                ).fetchone()
                total = int(agg["total"] or 0)
                n_div = int(agg["div_n"] or 0)
                info["obs_total"] = total
                info["divergent_n"] = n_div
                info["latest_obs"] = agg["latest"]
                if total:
                    info["divergence_pct"] = round(100.0 * n_div / total, 1)
                    info["obs_48h"] = conn.execute(
                        "SELECT COUNT(*) FROM shadow_observations "
                        "WHERE shadow_key = ? AND created_at > datetime('now','-2 days')",
                        (key,),
                    ).fetchone()[0] or 0
                    # Promotion-readiness: same Wilson rule as the legacy path,
                    # gated on the registry's own min_n (fallback PROMOTION_MIN_N).
                    info["promotion_n"] = n_div
                    if n_div < min_n:
                        info["promotion"] = "accruing"
                    else:
                        info["promotion"] = (
                            "ready" if _wilson_lb(n_div, total) > 0.0 else "accruing"
                        )
                    # Realized-outcome aggregate over LINKED observations only
                    # (realized_pnl_usd NOT NULL) — honest linked-n, never a
                    # full-count win-rate.
                    o = conn.execute(
                        "SELECT COUNT(realized_pnl_usd) AS linked, "
                        "SUM(CASE WHEN realized_pnl_usd > 0 THEN 1 ELSE 0 END) AS wins, "
                        "AVG(realized_pnl_usd) AS mean_pnl, "
                        "MIN(realized_pnl_usd) AS lo, MAX(realized_pnl_usd) AS hi "
                        "FROM shadow_observations "
                        "WHERE shadow_key = ? AND realized_pnl_usd IS NOT NULL",
                        (key,),
                    ).fetchone()
                    linked = int(o["linked"] or 0)
                    info["outcome_linked_n"] = linked
                    if linked > 0:
                        info["outcome_mean_pnl"] = round(float(o["mean_pnl"]), 2)
                        info["outcome_min_pnl"] = round(float(o["lo"]), 2)
                        info["outcome_max_pnl"] = round(float(o["hi"]), 2)
                        info["outcome_win_rate"] = round(
                            100.0 * int(o["wins"] or 0) / linked, 1
                        )
            except sqlite3.OperationalError as exc:
                info["error"] = f"obs read: {exc}"

        info["status"] = _classify_registered(info["obs_total"], info["latest_obs"])
        out.append(info)
    return out


def _enumerate(conn: sqlite3.Connection) -> list[str]:
    names = [
        r["name"]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%shadow%' "
            "ORDER BY name"
        )
        if r["name"] not in DEREGISTERED
    ]
    have = set(names)
    for extra in EXTRA_TABLES:
        if extra in DEREGISTERED:
            continue
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
            "registered_shadows": [],
            "replica_age_seconds": age, "replica_mtime": mtime,
            "error": f"{type(exc).__name__}: {exc}",
        }))
        return 0

    tables = [_inspect(conn, t) for t in _enumerate(conn)]
    try:
        registered = _registered_shadows(conn)  # B6 unified registry (additive)
    except Exception:
        registered = []
    conn.close()

    by_function: dict[str, list[str]] = {}
    by_status: dict[str, int] = {"ACTIVE": 0, "DORMANT": 0, "BROKEN": 0, "STALE": 0}
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
        "stale_count": by_status.get("STALE", 0),
        "stale_days": STALE_DAYS,
        "promotion_min_n": PROMOTION_MIN_N,
        "registered_shadows": registered,  # B6 unified registry (additive)
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
