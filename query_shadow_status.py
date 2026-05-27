#!/usr/bin/env python3
"""Shadow scoring status + full shadow-tables inventory for /intel?tab=shadow.

Existing ``shadow`` payload kept byte-identical (drives the detailed Shadow
Scoring card). New ``tables`` array drives the per-table grid (Active /
Broken / Dormant sections) added 2026-05-26.

shadow_scoring uses ``timestamp`` (not ``scored_at``).

Status classification (data-driven, not hard-coded):
    rows == 0  AND expected_active     → "BROKEN"
    rows == 0  AND NOT expected_active → "DORMANT"
    latest_write within 7 days         → "ACTIVE"
    otherwise                          → "DORMANT"

shadow_scoring is intentionally excluded from the new inventory — the
dedicated card above the grid already covers it in full.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

DB = "/home/trevor/trevor/trevor.db"
SHADOW_ROWS_REQUIRED = 200    # FUTURE_01 threshold
STALE_DAYS = 7                # latest_write < 7d ago → ACTIVE, else DORMANT


# ---------------------------------------------------------------------------
# key_stat computations — one function per table. Each returns a small dict
# rendered as label/value pairs on the card. Defensive: any exception inside
# is caught upstream and surfaced as an `error` string on the card row.
# ---------------------------------------------------------------------------


def _ks_alo(conn: sqlite3.Connection) -> Dict[str, Any]:
    row = conn.execute(
        """SELECT
              SUM(CASE WHEN fill_outcome='fill'    THEN 1 ELSE 0 END) AS fills,
              SUM(CASE WHEN fill_outcome='timeout' THEN 1 ELSE 0 END) AS timeouts,
              SUM(CASE WHEN fill_outcome='reject'  THEN 1 ELSE 0 END) AS rejects
           FROM alo_entry_shadow"""
    ).fetchone()
    return {"fills": row[0] or 0, "timeouts": row[1] or 0, "rejects": row[2] or 0}


def _ks_calibration_v2(conn: sqlite3.Connection) -> Dict[str, Any]:
    row = conn.execute(
        """SELECT COUNT(*) AS total,
                  SUM(CASE WHEN static_fires != calibrated_fires THEN 1 ELSE 0 END) AS divergent
           FROM calibration_v2_audit
           WHERE timestamp > datetime('now', '-2 days')"""
    ).fetchone()
    total = row[0] or 0
    div = row[1] or 0
    pct = round(100.0 * div / total, 1) if total > 0 else 0.0
    return {"total_48h": total, "divergent": div, "divergence_pct": pct}


def _ks_calibrator(conn: sqlite3.Connection) -> Dict[str, Any]:
    row = conn.execute(
        """SELECT COUNT(*)             AS total,
                  AVG(calibrator_delta) AS avg_delta,
                  MIN(calibrator_delta) AS min_delta,
                  MAX(calibrator_delta) AS max_delta
           FROM calibrator_audit
           WHERE timestamp > datetime('now', '-2 days')"""
    ).fetchone()
    total = row[0] or 0
    return {
        "total_48h": total,
        "avg_delta": round(row[1], 2) if row[1] is not None else 0.0,
        "min_delta": round(row[2], 2) if row[2] is not None else 0.0,
        "max_delta": round(row[3], 2) if row[3] is not None else 0.0,
    }


def _ks_double_filter(conn: sqlite3.Connection) -> Dict[str, Any]:
    row = conn.execute(
        """SELECT
              SUM(CASE WHEN final_decision='PASS'  THEN 1 ELSE 0 END) AS pass_n,
              SUM(CASE WHEN final_decision='BLOCK' THEN 1 ELSE 0 END) AS block_n,
              COUNT(*) AS total
           FROM double_filter_shadow_v1"""
    ).fetchone()
    pass_n = row[0] or 0
    block_n = row[1] or 0
    total = row[2] or 0
    pct = round(100.0 * block_n / total, 1) if total > 0 else 0.0
    return {"pass": pass_n, "block": block_n, "block_pct": pct}


def _ks_funding_cost(conn: sqlite3.Connection) -> Dict[str, Any]:
    row = conn.execute(
        "SELECT SUM(actual_funding_usd) FROM funding_cost_shadow"
    ).fetchone()
    total = row[0] if row[0] is not None else 0.0
    return {"total_funding_usd": round(float(total), 4)}


def _ks_gap_watchdog(conn: sqlite3.Connection) -> Dict[str, Any]:
    row = conn.execute(
        """SELECT COUNT(*)                                  AS cycles,
                  SUM(CASE WHEN gaps_found > 0 THEN 1 ELSE 0 END) AS gap_cycles,
                  SUM(alerts_emitted)                       AS alerts
           FROM gap_watchdog_shadow"""
    ).fetchone()
    return {
        "cycles": row[0] or 0,
        "gap_cycles": row[1] or 0,
        "alerts": row[2] or 0,
    }


def _ks_leverage_v2(conn: sqlite3.Connection) -> Dict[str, Any]:
    row = conn.execute(
        """SELECT COUNT(*) AS total,
                  SUM(CASE WHEN gate_liquidation_pass=1
                            AND gate_hard_stop_pass=1
                            AND gate_slippage_pass=1
                           THEN 1 ELSE 0 END) AS all_pass
           FROM leverage_v2_shadow"""
    ).fetchone()
    total = row[0] or 0
    all_pass = row[1] or 0
    return {
        "total": total,
        "all_gates_pass": all_pass,
        "pass_pct": round(100.0 * all_pass / total, 1) if total > 0 else 0.0,
    }


def _ks_meme_onchain(conn: sqlite3.Connection) -> Dict[str, Any]:
    total = conn.execute("SELECT COUNT(*) FROM meme_onchain_shadow_log").fetchone()[0]
    recent = conn.execute(
        "SELECT COUNT(*) FROM meme_onchain_shadow_log "
        "WHERE ts > CAST(strftime('%s', 'now', '-1 day') AS INTEGER)"
    ).fetchone()[0]
    return {"total": total, "rows_24h": recent}


def _ks_momentum_exit(conn: sqlite3.Connection) -> Dict[str, Any]:
    row = conn.execute(
        """SELECT
              SUM(CASE WHEN shadow_action LIKE '%HOLD%'   THEN 1 ELSE 0 END) AS v2_hold,
              SUM(CASE WHEN shadow_action LIKE '%EXIT%'   THEN 1 ELSE 0 END) AS v2_exit,
              SUM(CASE WHEN shadow_action='CONFIRM_EXIT'  THEN 1 ELSE 0 END) AS confirm
           FROM momentum_exit_shadow"""
    ).fetchone()
    return {
        "v2_hold": row[0] or 0,
        "v2_exit": row[1] or 0,
        "confirm_exit": row[2] or 0,
    }


def _ks_per_ticker_cap(conn: sqlite3.Connection) -> Dict[str, Any]:
    row = conn.execute(
        """SELECT COUNT(*) AS total,
                  SUM(CASE WHEN divergent=1 THEN 1 ELSE 0 END) AS div_n
           FROM per_ticker_cap_shadow"""
    ).fetchone()
    return {"total": row[0] or 0, "divergent": row[1] or 0}


def _ks_regime_gate(conn: sqlite3.Connection) -> Dict[str, Any]:
    row = conn.execute(
        """SELECT COUNT(*) AS total,
                  SUM(CASE WHEN prod_action='BLOCK' THEN 1 ELSE 0 END) AS blocked,
                  SUM(CASE WHEN divergent=1 THEN 1 ELSE 0 END) AS div_n
           FROM regime_gate_shadow"""
    ).fetchone()
    return {
        "total": row[0] or 0,
        "blocked": row[1] or 0,
        "divergent": row[2] or 0,
    }


def _ks_shadow_scorer_v2(conn: sqlite3.Connection) -> Dict[str, Any]:
    total = conn.execute("SELECT COUNT(*) FROM shadow_scorer_v2").fetchone()[0]
    return {"total": total}


def _ks_sizing_v2(conn: sqlite3.Connection) -> Dict[str, Any]:
    row = conn.execute(
        """SELECT COUNT(*) AS total,
                  AVG(v2_simulated_size_usd) AS avg_v2_size,
                  AVG(v1_size_usd) AS avg_v1_size
           FROM sizing_v2_shadow"""
    ).fetchone()
    return {
        "total": row[0] or 0,
        "avg_v2_size": round(row[1], 2) if row[1] is not None else 0.0,
        "avg_v1_size": round(row[2], 2) if row[2] is not None else 0.0,
    }


def _ks_slippage(conn: sqlite3.Connection) -> Dict[str, Any]:
    total = conn.execute("SELECT COUNT(*) FROM slippage_audit").fetchone()[0]
    recent = conn.execute(
        "SELECT COUNT(*) FROM slippage_audit WHERE created_at > datetime('now', '-2 days')"
    ).fetchone()[0]
    avg_bps = conn.execute("SELECT AVG(slippage_bps) FROM slippage_audit").fetchone()[0]
    return {
        "total": total,
        "total_48h": recent,
        "avg_bps": round(avg_bps, 2) if avg_bps is not None else 0.0,
    }


def _ks_threshold_recal(conn: sqlite3.Connection) -> Dict[str, Any]:
    row = conn.execute(
        """SELECT COUNT(*) AS total,
                  SUM(CASE WHEN divergent=1 THEN 1 ELSE 0 END) AS div_n
           FROM threshold_recalibration_shadow"""
    ).fetchone()
    total = row[0] or 0
    div = row[1] or 0
    # Gate threshold of 30 divergent rows is the promotion criterion.
    return {"total": total, "divergent": div, "gate_progress": f"{div}/30"}


def _ks_time_gate(conn: sqlite3.Connection) -> Dict[str, Any]:
    row = conn.execute(
        """SELECT COUNT(*) AS total,
                  SUM(CASE WHEN shadow_action='BLOCK' THEN 1 ELSE 0 END) AS blocks,
                  SUM(CASE WHEN shadow_action='PASS'  THEN 1 ELSE 0 END) AS passes
           FROM time_gate_shadow"""
    ).fetchone()
    return {
        "total": row[0] or 0,
        "shadow_blocks": row[1] or 0,
        "pass": row[2] or 0,
    }


def _ks_whale_source(conn: sqlite3.Connection) -> Dict[str, Any]:
    total = conn.execute("SELECT COUNT(*) FROM whale_source_shadow_log").fetchone()[0]
    recent = conn.execute(
        "SELECT COUNT(*) FROM whale_source_shadow_log "
        "WHERE ts > CAST(strftime('%s', 'now', '-1 day') AS INTEGER)"
    ).fetchone()[0]
    return {"total": total, "rows_24h": recent}


# ---------------------------------------------------------------------------
# Inventory definition — (table_name, display, ts_col, ts_kind, expected_active, key_stat_fn)
#   ts_kind: "iso" → SQLite TEXT (any of: 'YYYY-MM-DD HH:MM:SS' naive,
#                                          'YYYY-MM-DDTHH:MM:SS.fff±HH:MM' offset-aware)
#            "unix" → integer epoch seconds (meme/whale logs)
#   expected_active=True → rows==0 means BROKEN. False → rows==0 means DORMANT.
#   key_stat_fn may be None for tables where rows + latest_write are sufficient.
# ---------------------------------------------------------------------------

TABLE_DEFS: List[Tuple[str, str, str, str, bool, Optional[Callable[[sqlite3.Connection], Dict[str, Any]]]]] = [
    # --- ACTIVE (16 — shadow_scoring excluded; covered by dedicated card) ----
    ("alo_entry_shadow",              "ALO Entries",                "created_at",      "iso",  True,  _ks_alo),
    ("calibration_v2_audit",          "Calibrator V2 Audit",        "timestamp",       "iso",  True,  _ks_calibration_v2),
    ("calibrator_audit",              "Calibrator V1 Audit",        "timestamp",       "iso",  True,  _ks_calibrator),
    ("double_filter_shadow_v1",       "Double Filter (Guard+Gate)", "ts",              "iso",  True,  _ks_double_filter),
    ("funding_cost_shadow",           "Funding Cost",               "created_at",      "iso",  True,  _ks_funding_cost),
    ("gap_watchdog_shadow",           "Gap Watchdog",               "created_at",      "iso",  True,  _ks_gap_watchdog),
    ("leverage_v2_shadow",            "Leverage V2",                "created_at",      "iso",  True,  _ks_leverage_v2),
    ("meme_onchain_shadow_log",       "Meme On-Chain Log",          "ts",              "unix", True,  _ks_meme_onchain),
    ("momentum_exit_shadow",          "Momentum Exit V2",           "cycle_timestamp", "iso",  True,  _ks_momentum_exit),
    ("per_ticker_cap_shadow",         "Per-Ticker Cap",             "ts",              "iso",  True,  _ks_per_ticker_cap),
    ("regime_gate_shadow",            "Regime Gate",                "ts",              "iso",  True,  _ks_regime_gate),
    ("shadow_scorer_v2",              "Shadow Scorer V2 (A-F)",     "timestamp",       "iso",  True,  _ks_shadow_scorer_v2),
    ("sizing_v2_shadow",              "Sizing V2",                  "created_at",      "iso",  True,  _ks_sizing_v2),
    ("slippage_audit",                "Slippage Audit",             "created_at",      "iso",  True,  _ks_slippage),
    ("threshold_recalibration_shadow","Threshold Recalibration",    "timestamp",       "iso",  True,  _ks_threshold_recal),
    ("time_gate_shadow",              "Time Gate (P06)",            "ts",              "iso",  True,  _ks_time_gate),
    ("whale_source_shadow_log",       "Whale Source Log",           "ts",              "unix", True,  _ks_whale_source),
    # --- DORMANT (6 — expected to be 0 / stale; not BROKEN) ------------------
    ("exit_engine_shadow",            "Exit Engine",                "created_at",      "iso",  False, None),
    ("group_weight_shadow",           "Group Weight",               "timestamp",       "iso",  False, None),
    ("live_partial_shadow",           "Live Partials",              "created_at",      "iso",  False, None),
    ("partial_trigger_shadow",        "Partial Triggers",           "created_at",      "iso",  False, None),
    ("regime_gate_v2_shadow",         "Regime Gate V2",             "created_at",      "iso",  False, None),
    ("stop_floor_v2_shadow",          "Stop Floor V2",              "created_at",      "iso",  False, None),
]


def _parse_ts(s: str) -> datetime:
    """SQLite TEXT timestamp → naive UTC datetime.

    Handles 'YYYY-MM-DD HH:MM:SS' (naive — treated as UTC, which is how SQLite's
    datetime('now') emits) and 'YYYY-MM-DDTHH:MM:SS.fff±HH:MM' (offset-aware,
    converted to UTC). datetime.fromisoformat tolerates both shapes natively.
    """
    raw = s.strip()
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        # Older Python or odd spacing — last-resort strptime variants.
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f"):
            try:
                return datetime.strptime(raw, fmt)
            except ValueError:
                continue
        raise ValueError(f"unparseable ts: {s!r}")
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _classify(rows: int, latest_write: Optional[str], expected_active: bool) -> str:
    if rows == 0:
        return "BROKEN" if expected_active else "DORMANT"
    if not latest_write:
        return "DORMANT"
    try:
        now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
        age = now_utc - _parse_ts(latest_write)
        return "ACTIVE" if age < timedelta(days=STALE_DAYS) else "DORMANT"
    except Exception:
        return "DORMANT"


def _inspect_table(
    conn: sqlite3.Connection,
    name: str,
    display: str,
    ts_col: str,
    ts_kind: str,
    expected_active: bool,
    key_stat_fn: Optional[Callable[[sqlite3.Connection], Dict[str, Any]]],
) -> Dict[str, Any]:
    info: Dict[str, Any] = {
        "table_name": name,
        "display": display,
        "rows": 0,
        "rows_48h": 0,
        "latest_write": None,
        "status": "DORMANT",
        "key_stat": {},
        "error": None,
    }
    try:
        exists = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).fetchone()
        if not exists:
            info["status"] = "BROKEN" if expected_active else "DORMANT"
            info["error"] = "table not found"
            return info

        info["rows"] = conn.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]

        # Per-kind SQL: unix epoch tables need a different latest_write read +
        # recent-rows filter (string comparison against datetime() doesn't work).
        if ts_kind == "unix":
            last_row = conn.execute(
                f"SELECT datetime({ts_col}, 'unixepoch') FROM {name} "
                f"ORDER BY {ts_col} DESC LIMIT 1"
            ).fetchone()
            info["latest_write"] = last_row[0] if last_row else None
            info["rows_48h"] = conn.execute(
                f"SELECT COUNT(*) FROM {name} "
                f"WHERE {ts_col} > CAST(strftime('%s', 'now', '-2 days') AS INTEGER)"
            ).fetchone()[0]
        else:
            last_row = conn.execute(
                f"SELECT {ts_col} FROM {name} ORDER BY {ts_col} DESC LIMIT 1"
            ).fetchone()
            info["latest_write"] = last_row[0] if last_row else None
            info["rows_48h"] = conn.execute(
                f"SELECT COUNT(*) FROM {name} WHERE {ts_col} > datetime('now', '-2 days')"
            ).fetchone()[0]

        info["status"] = _classify(info["rows"], info["latest_write"], expected_active)

        if key_stat_fn is not None and info["rows"] > 0:
            try:
                info["key_stat"] = key_stat_fn(conn)
            except Exception as ks_err:
                info["error"] = f"key_stat error: {ks_err}"

    except Exception as exc:
        info["status"] = "BROKEN" if expected_active else "DORMANT"
        info["error"] = str(exc)

    return info


def main() -> None:
    out: Dict[str, Any] = {"shadow": {}, "tables": []}
    try:
        with sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10) as conn:
            conn.row_factory = sqlite3.Row

            # --- existing shadow_scoring payload (kept byte-identical) -------
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

            # --- new tables inventory ----------------------------------------
            for name, display, ts_col, ts_kind, expected, key_stat_fn in TABLE_DEFS:
                out["tables"].append(
                    _inspect_table(conn, name, display, ts_col, ts_kind, expected, key_stat_fn)
                )

        print(json.dumps(out))
    except Exception as exc:
        print(json.dumps({"shadow": {}, "tables": [], "error": str(exc)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    # OUTER-WRAP: 2026-05-27 (silent-crash visibility)
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        main()

    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
