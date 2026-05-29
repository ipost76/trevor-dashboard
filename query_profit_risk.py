#!/usr/bin/env python3
"""
Consolidated PROFIT-TAKING + RISK read for /api/auto/profit-risk (S1-P06).

READ-ONLY display feed for the Hub "Profit-Taking + Risk" panel. Surfaces
Stage-1 (S1-P01..P05) state that already lands in the bot DB / circuit
breaker but was never visible:

  1. Per open LIVE trade — fee-aware exit posture:
       breakeven armed?, ratchet floor (R), partials taken + realized
       partial P&L, intended risk ($ and %), notional vs original notional.
  2. Consolidated circuit-breaker state — entries allowed?, which breakers
       are active, and each breaker's current reading vs its limit.

NO ARGS. NO MUTATIONS. NO BOT COMMANDS. This script only reads:
  - `auto_trades` via a read-only sqlite URI (`file:...?mode=ro`), and
  - `circuit_breaker.CircuitBreakerSystem().get_status()` (the same entry
    point query_circuit_breaker.py already uses).

JSON output:
  {
    "data_available": bool,         # false only on a hard failure
    "ts": <epoch_seconds>,
    "open_count": <N>,
    "open_trades": [
      { id, ticker, direction, entry_price, stop_price, target_price,
        leverage, notional_usd, original_notional_usd, opened_at,
        peak_pnl_pct,
        breakeven_armed: bool,
        ratchet_locked_r: float,
        partials_taken: int,
        partial_pnl_realized: float,
        risk_dollars: float|null,   # NULL until S1 risk-sizing populates it
        risk_pct: float|null }
    ],
    "breakers": {
      "overall_status": "GREEN|YELLOW|RED|UNKNOWN",
      "override_active": bool,
      "entries_allowed": bool,      # derived: overall != RED (or override)
      "active": [ {key,label,status,detail} ],   # only non-OK breakers
      "all":    [ {key,label,status,value,limit,unit} ],  # every gauge
      "error": <str?>               # present iff breaker read failed
    }
  }

HONESTY NOTE (S1-P06): the bot exposes the REAL breakers — daily-loss cap
and consecutive-loss pause (Session layer), weekly-loss cap and max-open-
positions (Portfolio layer). The "frequency count / equity-curve 20-MA
pause" wording in some specs is S1-P05's *intended* consolidated set, which
is NOT in the bot yet. We surface only what get_status() actually returns;
if/when get_status() grows native `entries_allowed`/`active_breakers`, those
pass through and override the derived values.
"""
from __future__ import annotations

import json
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, "/home/trevor/trevor")

DB = "/home/trevor/trevor/trevor.db"


def _connect_ro() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10)


def _rows_to_dicts(cursor) -> list[dict]:
    cols = [c[0] for c in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def fetch_open_trades() -> list[dict]:
    """Open LIVE positions with Stage-1 exit + risk columns."""
    with _connect_ro() as conn:
        cur = conn.execute(
            """
            SELECT id, ticker, direction, entry_price, stop_price, target_price,
                   leverage, notional_usd, original_notional_usd, opened_at,
                   peak_pnl_pct, breakeven_stop_active, ratchet_locked_r,
                   partial_exits_taken, partial_pnl_realized,
                   risk_dollars_at_entry, risk_pct_at_entry
            FROM auto_trades
            WHERE status='open' AND trade_mode='live'
            ORDER BY opened_at DESC
            """
        )
        raw = _rows_to_dicts(cur)

    out: list[dict] = []
    for r in raw:
        out.append({
            "id": r["id"],
            "ticker": r["ticker"],
            "direction": r["direction"],
            "entry_price": r["entry_price"],
            "stop_price": r["stop_price"],
            "target_price": r["target_price"],
            "leverage": r["leverage"],
            "notional_usd": r["notional_usd"],
            "original_notional_usd": r["original_notional_usd"],
            "opened_at": r["opened_at"],
            "peak_pnl_pct": r["peak_pnl_pct"],
            # Stage-1 exit posture — coerce the stored 0/1 + NULLs defensively.
            "breakeven_armed": bool(r["breakeven_stop_active"]),
            "ratchet_locked_r": float(r["ratchet_locked_r"] or 0.0),
            "partials_taken": int(r["partial_exits_taken"] or 0),
            "partial_pnl_realized": float(r["partial_pnl_realized"] or 0.0),
            # Risk sizing — NULL until S1 risk-based sizing populates it; keep
            # null (not 0) so the UI can show "—" instead of a fake $0 risk.
            "risk_dollars": r["risk_dollars_at_entry"],
            "risk_pct": r["risk_pct_at_entry"],
        })
    return out


def _breaker_status_for(value, limit, *, lower_is_worse: bool,
                        yellow_frac: float = 0.7, ge_trips: bool = False) -> str:
    """Map a reading to OK/YELLOW/RED against its limit.

    lower_is_worse=True  → a loss cap (value < limit trips, e.g. -30 < -25).
    ge_trips=True        → a count cap (value >= limit trips, e.g. 5 >= 5).
    """
    try:
        v = float(value)
        lim = float(limit)
    except (TypeError, ValueError):
        return "OK"
    if ge_trips:
        if v >= lim:
            return "RED"
        if lim > 0 and v >= lim - 1:
            return "YELLOW"
        return "OK"
    if lower_is_worse:
        if v < lim:
            return "RED"
        if v <= lim * yellow_frac:  # caps are negative → *0.7 is "70% of the way"
            return "YELLOW"
        return "OK"
    return "OK"


def build_breakers() -> dict:
    """Real circuit-breaker state via CircuitBreakerSystem.get_status()."""
    try:
        from circuit_breaker import CircuitBreakerSystem
        status = CircuitBreakerSystem().get_status()
    except Exception as exc:  # bot import/read failure — degrade, don't crash
        return {
            "overall_status": "UNKNOWN",
            "override_active": False,
            "entries_allowed": False,
            "active": [],
            "all": [],
            "error": f"{type(exc).__name__}: {exc}",
        }

    overall = status.get("overall_status", "UNKNOWN")
    override = bool(status.get("override_active", False))
    layers = status.get("layers", {}) or {}
    session = layers.get("session", {}) or {}
    portfolio = layers.get("portfolio", {}) or {}

    daily_pnl = session.get("daily_pnl_pct", 0.0)
    daily_cap = session.get("daily_cap", 0.0)
    consec = session.get("consecutive_losses", 0)
    consec_limit = session.get("consec_limit", 0)
    weekly_pnl = portfolio.get("weekly_pnl_pct", 0.0)
    weekly_cap = portfolio.get("weekly_cap", 0.0)
    open_pos = portfolio.get("open_positions", 0)
    max_pos = portfolio.get("max_positions", 0)

    all_breakers = [
        {
            "key": "daily_loss",
            "label": "Daily Loss Cap",
            "status": _breaker_status_for(daily_pnl, daily_cap, lower_is_worse=True),
            "value": daily_pnl,
            "limit": daily_cap,
            "unit": "%",
        },
        {
            "key": "consecutive_losses",
            "label": "Consecutive Losses",
            "status": _breaker_status_for(consec, consec_limit, lower_is_worse=False, ge_trips=True),
            "value": consec,
            "limit": consec_limit,
            "unit": "count",
        },
        {
            "key": "weekly_loss",
            "label": "Weekly Loss Cap",
            "status": _breaker_status_for(weekly_pnl, weekly_cap, lower_is_worse=True),
            "value": weekly_pnl,
            "limit": weekly_cap,
            "unit": "%",
        },
        {
            "key": "open_positions",
            "label": "Open Positions",
            "status": _breaker_status_for(open_pos, max_pos, lower_is_worse=False, ge_trips=True),
            "value": open_pos,
            "limit": max_pos,
            "unit": "count",
        },
    ]

    def _detail(b: dict) -> str:
        if b["unit"] == "%":
            return f"{b['value']:.1f}% vs {b['limit']:.0f}% cap"
        return f"{int(b['value'])} / {int(b['limit'])}"

    active = [
        {"key": b["key"], "label": b["label"], "status": b["status"], "detail": _detail(b)}
        for b in all_breakers if b["status"] != "OK"
    ]

    # Derived entries gate. Prefer a native consolidated value if S1-P05 ever
    # adds it to get_status(); otherwise derive from overall_status.
    if "entries_allowed" in status:
        entries_allowed = bool(status["entries_allowed"])
    else:
        entries_allowed = overall != "RED"
    if "active_breakers" in status and isinstance(status["active_breakers"], list):
        active = status["active_breakers"]

    return {
        "overall_status": overall,
        "override_active": override,
        "entries_allowed": entries_allowed,
        "active": active,
        "all": all_breakers,
    }


def main() -> int:
    if not Path(DB).exists():
        sys.stdout.write(json.dumps({
            "data_available": False,
            "ts": int(time.time()),
            "open_count": 0,
            "open_trades": [],
            "breakers": {
                "overall_status": "UNKNOWN", "override_active": False,
                "entries_allowed": False, "active": [], "all": [],
                "error": f"DB not found: {DB}",
            },
            "error": f"DB not found: {DB}",
        }))
        return 0

    try:
        open_trades = fetch_open_trades()
    except Exception as exc:
        open_trades = []
        trades_err = f"{type(exc).__name__}: {exc}"
    else:
        trades_err = None

    breakers = build_breakers()

    out = {
        "data_available": trades_err is None,
        "ts": int(time.time()),
        "open_count": len(open_trades),
        "open_trades": open_trades,
        "breakers": breakers,
    }
    if trades_err:
        out["error"] = trades_err
    sys.stdout.write(json.dumps(out, default=str))
    return 0


if __name__ == "__main__":
    # OUTER-WRAP: silent-crash visibility (matches sibling query_*.py helpers).
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        # Still emit a clean fail-safe shape so the route never 500s on parse.
        _sys_wrap.stdout.write(json.dumps({
            "data_available": False, "ts": int(time.time()),
            "open_count": 0, "open_trades": [],
            "breakers": {"overall_status": "UNKNOWN", "override_active": False,
                         "entries_allowed": False, "active": [], "all": []},
        }))
        _sys_wrap.exit(0)
