#!/usr/bin/env python3
"""query_shadow_compare.py — S3-P07 backend for /api/shadow/compare.

Read-only would-be-vs-actual roll-up across the six Stage-2/3 *shadow
overlays* the Hub surfaces for promotion decisions. Each overlay logs its
own table (the "source tag" is the table itself); this script reads each,
computes a per-overlay promote-readiness verdict, and shapes it for the
Intel→Promote panel. It NEVER writes — opens the bot DB `?mode=ro`.

The six overlays:
  1. Regime-Aware Exits      S2-P04  regime_exit_shadow      (Exit)
  2. Funding Signal          S3-P01  funding_signal_shadow   (Data)
  3. CVD/OI Hold-vs-Bank     S3-P02  cvd_oi_exit_shadow      (Exit)
  4. Reversal Early Exit     S3-P03  reversal_exit_shadow    (Exit)
  5. Exhaustion Entry Filter S3-P04  exhaustion_entry_shadow (Entry)
  6. Time/Session Exits      S3-P06  <built in parallel>     (Exit)

Honesty protocol (load-bearing): overlays below MIN_SAMPLES *resolved
divergent* decisions report `readiness="insufficient_data"` and NEVER a
conclusive helped%/P&L number. Overlay #6's table does not exist yet (it
is built by the parallel S3-P06 task) — it reports `not_reporting` and
lights up automatically when its table appears, with no coupling. We do
NOT reuse time_gate_shadow (an *entry* gate) as the S3-P06 exit table.

Per-overlay metric derivation is documented in each config's
`metric_basis` string and echoed in the payload for full transparency,
because the overlays log heterogeneous columns and a couple expose no
clean closed-form P&L delta (reported as null, not fabricated).

Output JSON shape:
  {
    "min_samples": 20,
    "overlays": [ {
      "key": str, "table": str, "display": str, "stage": str,
      "function": "Entry"|"Exit"|"Scoring"|"Risk"|"Data",
      "present": bool,
      "decisions_total": int, "decisions_7d": int,
      "resolved": int, "divergent": int, "divergent_resolved": int,
      "helped_pct": float|null,        # % of divergent_resolved that helped
      "est_pnl_delta": float|null,     # cumulative, in delta_unit
      "delta_unit": "R"|null,
      "metric_basis": str,             # how helped/delta were derived
      "latest_write": str|null,
      "readiness": "insufficient_data"|"not_reporting"|"underperforms"|"candidate",
      "readiness_note": str,
      "recent": [ {created_at,ticker,direction,would_be,live,divergent,outcome,helped} ],
      "error": str (optional)
    }, ... ],
    "summary": { "candidate": int, "underperforms": int,
                 "insufficient_data": int, "not_reporting": int },
    "error": str (optional top-level — DB unopenable)
  }
"""
from __future__ import annotations

import json
import sqlite3
import sys
from typing import Optional

DB_PATH = "/home/trevor/trevor/trevor.db"
DB_RO_URI = f"file:{DB_PATH}?mode=ro"

# Minimum resolved *divergent* decisions before a helped%/P&L verdict is
# allowed to be conclusive. Below this → "insufficient_data".
MIN_SAMPLES = 20
# helped% at-or-above this (with positive delta where a delta exists) →
# promotion candidate; below 50 → underperforms.
HELP_THRESHOLD = 50.0
RECENT_LIMIT = 8

# S3-P06 builds in parallel; its table name is unknown, so probe a small
# candidate set (decoupled — first that exists wins). NOT time_gate_shadow
# (that is an *entry* gate, a different overlay).
SESSION_EXIT_CANDIDATES = [
    "session_exit_shadow",
    "time_exit_shadow",
    "time_session_exit_shadow",
    "session_time_exit_shadow",
]

# ── Per-overlay config ──────────────────────────────────────────────────────
# divergent_sql  : boolean — would-be action differs from live
# resolved_sql   : boolean — the outcome window has resolved
# helped_sql     : 1/0 per divergent+resolved row, or None if not derivable
# delta_sql      : per-row P&L delta (would-be minus actual), or None if n/a
# delta_unit     : unit label for the cumulative delta, or None
# recent_*       : column/exprs to normalise the recent-rows feed
OVERLAYS: list[dict] = [
    {
        "key": "regime_exit",
        "table": "regime_exit_shadow",
        "display": "Regime-Aware Exits",
        "stage": "S2-P04",
        "function": "Exit",
        "ts_col": "created_at",
        "divergent_sql": "divergent = 1",
        "resolved_sql": "pnl_pct IS NOT NULL",
        # would_tp_r/would_trail_mult are in R-multiples while the only
        # realised-outcome column (pnl_pct) is a percent — no realised-R
        # field is logged, so a P&L delta would mix units. We track
        # divergence only and decline to fabricate a number.
        "helped_sql": None,
        "delta_sql": None,
        "delta_unit": None,
        "metric_basis": (
            "Divergence-only: logged columns mix R (would_tp_r/peak_r) and "
            "percent (pnl_pct) with no realised-R field, so a P&L delta is "
            "not derivable without exit replay. Divergence + sample tracked."
        ),
        "recent_ticker": "ticker",
        "recent_dir": "direction",
        "recent_would": "'tp_r=' || COALESCE(would_tp_r,'?')",
        "recent_live": "COALESCE(live_action,'-')",
        "recent_outcome": "pnl_pct",
    },
    {
        "key": "funding_signal",
        "table": "funding_signal_shadow",
        "display": "Funding Signal",
        "stage": "S3-P01",
        "function": "Data",
        "ts_col": "created_at",
        # Every emitted signal is a would-be directional bias vs live's
        # no-action; treat each as a divergent decision.
        "divergent_sql": "would_be_bias IS NOT NULL",
        "resolved_sql": "outcome_confirmed IS NOT NULL",
        "helped_sql": "CASE WHEN outcome_confirmed = 1 THEN 1 ELSE 0 END",
        # Directional signal, no execution → no P&L delta; hit-rate only.
        "delta_sql": None,
        "delta_unit": None,
        "metric_basis": (
            "Directional signal (no execution). helped = outcome_confirmed "
            "(price moved as biased); reported as a hit-rate — no P&L delta."
        ),
        "recent_ticker": "ticker",
        "recent_dir": "signal_direction",
        "recent_would": "COALESCE(would_be_bias,'-')",
        "recent_live": "'(no exec)'",
        "recent_outcome": "outcome_confirmed",
    },
    {
        "key": "cvd_oi_exit",
        "table": "cvd_oi_exit_shadow",
        "display": "CVD/OI Hold-vs-Bank",
        "stage": "S3-P02",
        "function": "Exit",
        "ts_col": "created_at",
        "divergent_sql": (
            "would_be_action IS NOT NULL "
            "AND would_be_action <> COALESCE(live_action, raw_action)"
        ),
        "resolved_sql": "r_multiple IS NOT NULL AND eventual_outcome IS NOT NULL",
        # Overlay banks earlier on CVD/OI weakness. helped when holding gave
        # back (eventual_outcome < R at decision); delta = R recaptured by
        # banking earlier. Assumes r_multiple & eventual_outcome share units.
        "helped_sql": "CASE WHEN eventual_outcome < r_multiple THEN 1 ELSE 0 END",
        "delta_sql": "(r_multiple - eventual_outcome)",
        "delta_unit": "R",
        "metric_basis": (
            "Early-bank model: divergent = would_be_action <> live; helped = "
            "eventual_outcome < r_multiple (held position gave back); delta = "
            "r_multiple - eventual_outcome (R recaptured). Assumes both in R."
        ),
        "recent_ticker": "ticker",
        "recent_dir": "direction",
        "recent_would": "COALESCE(would_be_action,'-')",
        "recent_live": "COALESCE(live_action, raw_action, '-')",
        "recent_outcome": "r_multiple",
    },
    {
        "key": "reversal_exit",
        "table": "reversal_exit_shadow",
        "display": "Reversal Early Exit",
        "stage": "S3-P03",
        "function": "Exit",
        "ts_col": "created_at",
        "divergent_sql": (
            "would_be_action IS NOT NULL "
            "AND would_be_action <> COALESCE(live_action, raw_action)"
        ),
        "resolved_sql": "r_multiple IS NOT NULL AND eventual_outcome IS NOT NULL",
        "helped_sql": "CASE WHEN eventual_outcome < r_multiple THEN 1 ELSE 0 END",
        "delta_sql": "(r_multiple - eventual_outcome)",
        "delta_unit": "R",
        "metric_basis": (
            "Early-exit model: divergent = would_be_action <> live; helped = "
            "eventual_outcome < r_multiple (reversal materialised); delta = "
            "r_multiple - eventual_outcome (R saved). Assumes both in R."
        ),
        "recent_ticker": "ticker",
        "recent_dir": "direction",
        "recent_would": "COALESCE(would_be_action,'-')",
        "recent_live": "COALESCE(live_action, raw_action, '-')",
        "recent_outcome": "r_multiple",
    },
    {
        "key": "exhaustion_entry",
        "table": "exhaustion_entry_shadow",
        "display": "Exhaustion Entry Filter",
        "stage": "S3-P04",
        "function": "Entry",
        "ts_col": "created_at",
        # Overlay would block an entry live took.
        "divergent_sql": "would_block = 1",
        "resolved_sql": "eventual_outcome IS NOT NULL",
        # Blocking helped if the entry it blocked lost money.
        "helped_sql": "CASE WHEN eventual_outcome < 0 THEN 1 ELSE 0 END",
        "delta_sql": "(-eventual_outcome)",
        "delta_unit": "R",
        "metric_basis": (
            "Avoided-loss model: divergent = would_block=1 (overlay blocks an "
            "entry live took); helped = blocked entry's eventual_outcome < 0; "
            "delta = -eventual_outcome (P&L avoided). Unit follows the log."
        ),
        "recent_ticker": "ticker",
        "recent_dir": "direction",
        "recent_would": "'BLOCK'",
        "recent_live": "COALESCE(live_action,'ENTER')",
        "recent_outcome": "eventual_outcome",
    },
    # Overlay #6 — built in parallel (S3-P06). Table & schema unknown; the
    # config carries no metric SQL. handled by _probe_session_exit().
    {
        "key": "session_exit",
        "table": "session_exit_shadow",  # primary expected name
        "display": "Time/Session Exits",
        "stage": "S3-P06",
        "function": "Exit",
        "dynamic": True,
        "metric_basis": (
            "Built in parallel (S3-P06). Lights up automatically when its "
            "shadow table appears; metric wiring follows once its schema lands."
        ),
    },
]


def _conn_ro() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_RO_URI, uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
        (name,),
    ).fetchone()
    return row is not None


def _empty_overlay(cfg: dict, present: bool, readiness: str,
                   note: str, error: Optional[str] = None) -> dict:
    out = {
        "key": cfg["key"],
        "table": cfg["table"],
        "display": cfg["display"],
        "stage": cfg["stage"],
        "function": cfg["function"],
        "present": present,
        "decisions_total": 0,
        "decisions_7d": 0,
        "resolved": 0,
        "divergent": 0,
        "divergent_resolved": 0,
        "helped_pct": None,
        "est_pnl_delta": None,
        "delta_unit": cfg.get("delta_unit"),
        "metric_basis": cfg["metric_basis"],
        "latest_write": None,
        "readiness": readiness,
        "readiness_note": note,
        "recent": [],
    }
    if error:
        out["error"] = error
    return out


def _classify(divergent_resolved: int, helped_pct: Optional[float],
              delta: Optional[float], has_delta: bool) -> tuple[str, str]:
    """Promote-readiness verdict. Honest enum:
    insufficient_data / underperforms / candidate (not_reporting handled upstream).
    """
    if divergent_resolved < MIN_SAMPLES:
        return (
            "insufficient_data",
            f"{divergent_resolved}/{MIN_SAMPLES} resolved divergent decisions "
            f"— need more data before a verdict.",
        )
    if helped_pct is None:
        # Divergence tracked but no outcome metric derivable (e.g. regime_exit).
        return (
            "insufficient_data",
            "Divergence tracked but no outcome metric is derivable from this "
            "overlay's logged columns — promotion verdict not possible.",
        )
    if has_delta:
        if (delta or 0) <= 0 or helped_pct < HELP_THRESHOLD:
            return (
                "underperforms",
                f"helped {helped_pct:.0f}% of {divergent_resolved} divergent "
                f"decisions; est. delta {delta:+.2f} — does not beat baseline.",
            )
        return (
            "candidate",
            f"helped {helped_pct:.0f}% of {divergent_resolved} divergent "
            f"decisions; est. delta {delta:+.2f} — beats baseline.",
        )
    # No P&L delta (directional, e.g. funding) → judge on hit-rate alone.
    if helped_pct < HELP_THRESHOLD:
        return (
            "underperforms",
            f"hit-rate {helped_pct:.0f}% over {divergent_resolved} resolved "
            f"signals — below 50%.",
        )
    return (
        "candidate",
        f"hit-rate {helped_pct:.0f}% over {divergent_resolved} resolved "
        f"signals — beats coin-flip.",
    )


def _process(conn: sqlite3.Connection, cfg: dict) -> dict:
    table = cfg["table"]
    ts = cfg["ts_col"]
    if not _table_exists(conn, table):
        # One of the five known tables vanished — BROKEN-ish; report honestly.
        return _empty_overlay(
            cfg, present=False, readiness="not_reporting",
            note=f"Table {table} not found.",
            error=f"missing table: {table}",
        )

    has_delta = cfg.get("delta_sql") is not None
    has_helped = cfg.get("helped_sql") is not None
    div = cfg["divergent_sql"]
    res = cfg["resolved_sql"]
    helped = cfg.get("helped_sql") or "0"
    delta = cfg.get("delta_sql") or "0"

    # Single aggregate pass — counts + metric sums over divergent&resolved rows.
    agg_sql = f"""
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN {ts} > datetime('now','-7 days') THEN 1 ELSE 0 END) AS d7,
          SUM(CASE WHEN {res} THEN 1 ELSE 0 END) AS resolved,
          SUM(CASE WHEN {div} THEN 1 ELSE 0 END) AS divergent,
          SUM(CASE WHEN ({div}) AND ({res}) THEN 1 ELSE 0 END) AS div_resolved,
          SUM(CASE WHEN ({div}) AND ({res}) THEN ({helped}) ELSE 0 END) AS helped_sum,
          SUM(CASE WHEN ({div}) AND ({res}) THEN ({delta}) ELSE 0 END) AS delta_sum,
          MAX({ts}) AS latest
        FROM {table}
    """
    row = conn.execute(agg_sql).fetchone()

    total = row["total"] or 0
    div_resolved = row["div_resolved"] or 0
    helped_sum = row["helped_sum"] or 0
    delta_sum = row["delta_sum"] or 0.0

    helped_pct: Optional[float] = None
    if has_helped and div_resolved > 0:
        helped_pct = round(100.0 * helped_sum / div_resolved, 1)

    est_delta: Optional[float] = None
    if has_delta and div_resolved > 0:
        est_delta = round(float(delta_sum), 4)

    readiness, note = _classify(div_resolved, helped_pct, est_delta, has_delta)

    # Recent normalised rows (newest first). Empty tables yield [].
    recent: list[dict] = []
    try:
        rec_sql = f"""
            SELECT {ts} AS created_at,
                   {cfg['recent_ticker']} AS ticker,
                   {cfg['recent_dir']} AS direction,
                   {cfg['recent_would']} AS would_be,
                   {cfg['recent_live']} AS live,
                   CASE WHEN {div} THEN 1 ELSE 0 END AS divergent,
                   {cfg['recent_outcome']} AS outcome,
                   CASE WHEN ({div}) AND ({res}) THEN ({helped})
                        ELSE NULL END AS helped
            FROM {table}
            ORDER BY {ts} DESC
            LIMIT {RECENT_LIMIT}
        """
        for r in conn.execute(rec_sql).fetchall():
            recent.append({
                "created_at": r["created_at"],
                "ticker": r["ticker"],
                "direction": r["direction"],
                "would_be": r["would_be"],
                "live": r["live"],
                "divergent": bool(r["divergent"]),
                "outcome": r["outcome"],
                "helped": None if r["helped"] is None else bool(r["helped"]),
            })
    except sqlite3.OperationalError:
        pass  # recent feed is best-effort

    return {
        "key": cfg["key"],
        "table": table,
        "display": cfg["display"],
        "stage": cfg["stage"],
        "function": cfg["function"],
        "present": True,
        "decisions_total": total,
        "decisions_7d": row["d7"] or 0,
        "resolved": row["resolved"] or 0,
        "divergent": row["divergent"] or 0,
        "divergent_resolved": div_resolved,
        "helped_pct": helped_pct,
        "est_pnl_delta": est_delta,
        "delta_unit": cfg.get("delta_unit"),
        "metric_basis": cfg["metric_basis"],
        "latest_write": row["latest"],
        "readiness": readiness,
        "readiness_note": note,
        "recent": recent,
    }


def _probe_session_exit(conn: sqlite3.Connection, cfg: dict) -> dict:
    """Overlay #6 (S3-P06) — table built in parallel. Probe candidate names;
    if found, report row count + latest generically (schema unknown → no
    helped%/delta yet). If absent, not_reporting. No coupling either way."""
    found = next((t for t in SESSION_EXIT_CANDIDATES if _table_exists(conn, t)), None)
    if not found:
        return _empty_overlay(
            cfg, present=False, readiness="not_reporting",
            note="Built in parallel (S3-P06) — table not yet present. Will "
                 "light up automatically when its shadow table appears.",
        )

    out = _empty_overlay(
        cfg, present=True, readiness="insufficient_data",
        note="Table present; metric wiring pending its schema (S3-P06 ships "
             "in parallel). Showing volume only.",
    )
    out["table"] = found
    try:
        out["decisions_total"] = conn.execute(
            f"SELECT COUNT(*) FROM {found}"
        ).fetchone()[0] or 0
        # Best-effort latest write across the usual ts column names.
        for c in ("created_at", "ts", "timestamp"):
            try:
                out["latest_write"] = conn.execute(
                    f"SELECT MAX({c}) FROM {found}"
                ).fetchone()[0]
                break
            except sqlite3.OperationalError:
                continue
    except sqlite3.OperationalError as exc:
        out["error"] = f"probe failed: {exc}"
    return out


def main() -> int:
    try:
        conn = _conn_ro()
    except Exception as exc:
        print(json.dumps({
            "min_samples": MIN_SAMPLES,
            "overlays": [],
            "summary": {},
            "error": f"{type(exc).__name__}: {exc}",
        }))
        return 0

    overlays: list[dict] = []
    for cfg in OVERLAYS:
        try:
            if cfg.get("dynamic"):
                overlays.append(_probe_session_exit(conn, cfg))
            else:
                overlays.append(_process(conn, cfg))
        except Exception as exc:
            overlays.append(_empty_overlay(
                cfg, present=False, readiness="not_reporting",
                note=f"read error: {type(exc).__name__}",
                error=f"{type(exc).__name__}: {exc}",
            ))
    conn.close()

    summary = {"candidate": 0, "underperforms": 0,
               "insufficient_data": 0, "not_reporting": 0}
    for o in overlays:
        summary[o["readiness"]] = summary.get(o["readiness"], 0) + 1

    print(json.dumps({
        "min_samples": MIN_SAMPLES,
        "overlays": overlays,
        "summary": summary,
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
