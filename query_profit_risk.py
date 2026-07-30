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
      "overall_status": "OK|YELLOW|RED|OFF|UNKNOWN",
      "override_active": bool,
      "entries_allowed": bool,      # derived: overall != RED (or override)
      # RD-B7 freshness of the EVALUATION (signal-driven — see BREAKER_EVAL_STALE_S).
      # UNKNOWN = "the breaker has not been asked", NOT "the breaker failed".
      "last_eval_at": <iso_utc>|null,      # absolute; consumers recompute age off this
      "last_eval_age_s": <int>|null,       # server snapshot (can freeze behind SWR)
      "last_eval_stale": bool,             # age > last_eval_stale_after_s
      "last_eval_stale_after_s": <int>,    # the bound itself, so the UI can explain it
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
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, "/home/trevor/trevor")

DB = "/home/trevor/trevor/trevor.db"

UTC = timezone.utc

# RD-B7 (2026-07-25): staleness ceiling for the consolidated breaker readout.
# Matches query_auto_state.py's LIVE_ACCOUNT_VALUE_STALE_S pattern (documented
# constant → `*_age_s` + `*_stale`), NOT a second convention.
#
# DERIVATION — the breaker is SIGNAL-DRIVEN, not timer-driven. evaluate_breakers()
# runs at Gate 0.5 inside the per-signal handler (auto_trader/manager.py:933-941)
# and risk_breakers._persist_state writes RISK_BREAKERS_LAST_EVAL on each
# evaluation. So "how stale is abnormal" is really "how long without a SIGNAL is
# abnormal". Measured over 14 days of trade_insights (n=870 inter-signal gaps):
#   p50 718s · p90 3422s · p95 4861s · p99 9720s · max 36539s
#   median daily-max quiet stretch 9720s (2.7h), range 4858-36539s
# 14400s (4h) is ~3x p95 and ~1.5x the median daily worst-case quiet, so routine
# quiet never trips it; it is also >=24x the measured read-replica data lag
# (~600s; <=1800s worst case per the continuous-restore runbook), so replica lag
# alone can never trip it either. Wall-clock UNKNOWN rate at this bound: 3.0%
# over the last 14 days (vs 38.7% at 30min, 19.6% at 1h, 7.3% at 2h) — rare
# enough to mean something, frequent enough to actually be exercised.
BREAKER_EVAL_STALE_S = 14400


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
            -- W4a (2026-07-30): mode-blind. Under PAPER_WINDOW_ENABLED every
            -- open position is trade_mode='paper', so the live-only filter left
            -- this panel permanently empty and Ghost with no exit posture
            -- (breakeven armed? ratchet floor? partials taken?) for the trade
            -- he is actually running.
            WHERE status='open'
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


# BRK-W1 (2026-06-04): the LIVE entry gate is auto_trader/risk_breakers.py,
# which mirrors its consolidated state into auto_config.RISK_BREAKERS_STATE_JSON
# on every evaluation. We read THAT (the source of truth) instead of the dormant
# legacy circuit_breaker.py (CB_SESSION/PORTFOLIO_ENABLED=false → Weekly Loss /
# Open Positions never fire). After BRK-W1 the live gate has ONE breaker —
# daily_loss (-25%/day realized). This map renders whatever `detail` keys the
# live state carries, so a re-armed breaker would show up automatically.
_BREAKER_LABELS = {
    "daily_loss": "Daily Loss Cap",
    "consecutive_losses": "Consecutive Losses",
    "frequency": "Daily Round-Trips",
    "equity_curve": "Equity Curve",
}


def _breaker_gauge(code: str, info: dict) -> dict:
    """Map one live risk_breakers `detail` entry → a display gauge."""
    label = _BREAKER_LABELS.get(code, code.replace("_", " ").title())
    active = bool(info.get("active"))
    status = "RED" if active else "OK"
    if code == "daily_loss":
        value, limit, unit = info.get("loss_pct", 0.0), info.get("limit_pct", 0.0), "%"
    elif code == "consecutive_losses":
        value, limit, unit = info.get("streak", 0), info.get("limit", 0), "count"
    elif code == "frequency":
        value, limit, unit = info.get("trades_today", 0), info.get("cap", 0), "count"
    elif code == "equity_curve":
        value, limit, unit = info.get("current_equity", 0.0), info.get("ma", 0.0), "$"
    else:
        value, limit, unit = info.get("value", 0.0), info.get("limit", 0.0), ""
    return {"key": code, "label": label, "status": status,
            "value": value, "limit": limit, "unit": unit}


def _parse_last_eval(raw_value, raw_updated_at) -> tuple[str | None, int | None, bool]:
    """Freshness of the breaker's LAST EVALUATION → (iso_utc, age_s, stale).

    RD-B7. `RISK_BREAKERS_LAST_EVAL` is written by risk_breakers._persist_state as
    `datetime.utcnow().isoformat() + "Z"` — real UTC, explicit. The auto_config
    row's `updated_at` ('YYYY-MM-DD HH:MM:SS', also real UTC) is the fallback when
    the value is missing/unparseable. Age is UTC-vs-UTC — no clock crossing.

    The read-replica lag (~10min measured, <=30min per the continuous-restore
    runbook) means the newest LAST_EVAL we can SEE may trail the VM's, so the age
    returned is an UPPER BOUND on the true age: we may report stale slightly early,
    NEVER fresh late. That is the fail-safe direction.

    Fail-safe: missing / unparseable / unreadable → stale=True. A breaker readout
    we cannot date is UNKNOWN, never a silent OK.
    """
    now_utc = datetime.now(UTC)
    for raw, fmt in ((raw_value, "iso"), (raw_updated_at, "%Y-%m-%d %H:%M:%S")):
        if raw is None:
            continue
        text = str(raw).strip()
        if not text:
            continue
        try:
            if fmt == "iso":
                parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
                parsed = parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
            else:
                parsed = datetime.strptime(text, fmt).replace(tzinfo=UTC)
        except (ValueError, TypeError):
            continue
        age = int((now_utc - parsed).total_seconds())
        return (
            parsed.isoformat().replace("+00:00", "Z"),
            age,
            age > BREAKER_EVAL_STALE_S,
        )
    return (None, None, True)


def build_breakers() -> dict:
    """Live circuit-breaker state via auto_config.RISK_BREAKERS_STATE_JSON
    (the risk_breakers.py consolidated mirror — NOT legacy circuit_breaker.py).

    RD-B7 (2026-07-25): also carries the EVALUATION's freshness. Previously this
    read only STATE_JSON + ENABLED, so a frozen breaker was pixel-identical to a
    healthy one — the card said OK against an evaluation of any age. It now emits
    `last_eval_at` / `last_eval_age_s` / `last_eval_stale`, and a stale evaluation
    renders overall_status="UNKNOWN".

    UNKNOWN means UNKNOWN — NOT failed. The breaker only evaluates when a signal
    reaches Gate 0.5, so a quiet stretch legitimately leaves it un-run. `active`
    and `entries_allowed` therefore pass through the last known reading UNCHANGED;
    the caller decides how to present them against `last_eval_stale`. Turning a
    stale readout into a RED halt would be the same defect with the opposite
    colour.
    """
    try:
        with _connect_ro() as conn:
            rows = {
                key: (value, updated_at)
                for key, value, updated_at in conn.execute(
                    "SELECT key, value, updated_at FROM auto_config "
                    "WHERE key IN ('RISK_BREAKERS_STATE_JSON','RISK_BREAKERS_ENABLED',"
                    "'RISK_BREAKERS_LAST_EVAL')"
                ).fetchall()
            }
        state = json.loads((rows.get("RISK_BREAKERS_STATE_JSON") or (None, None))[0] or "{}")
        enabled_raw = (rows.get("RISK_BREAKERS_ENABLED") or (None, None))[0]
        enabled = (enabled_raw or "true").strip().lower() in ("true", "1", "yes")
        # Prefer LAST_EVAL's own value; fall back to the STATE_JSON row's
        # updated_at (written in the same _persist_state call).
        eval_value, eval_updated_at = rows.get("RISK_BREAKERS_LAST_EVAL") or (None, None)
        if eval_value is None:
            eval_updated_at = (rows.get("RISK_BREAKERS_STATE_JSON") or (None, None))[1]
        last_eval_at, last_eval_age_s, last_eval_stale = _parse_last_eval(
            eval_value, eval_updated_at
        )
    except Exception as exc:  # DB/parse failure — degrade, don't crash
        return {
            "overall_status": "UNKNOWN",
            "override_active": False,
            "entries_allowed": False,
            "last_eval_at": None,
            "last_eval_age_s": None,
            "last_eval_stale": True,
            "last_eval_stale_after_s": BREAKER_EVAL_STALE_S,
            "active": [],
            "all": [],
            "error": f"{type(exc).__name__}: {exc}",
        }

    detail = state.get("detail", {}) or {}
    entries_allowed = bool(state.get("entries_allowed", True))
    active_codes = state.get("active_breakers", []) or []

    all_breakers = [_breaker_gauge(code, info) for code, info in detail.items()]

    def _fmt(b: dict) -> str:
        if b["unit"] == "%":
            return f"{float(b['value']):.1f}% vs {float(b['limit']):.0f}% cap"
        if b["unit"] == "$":
            return f"${float(b['value']):.2f} vs ${float(b['limit']):.2f} MA"
        return f"{int(b['value'])} / {int(b['limit'])}"

    active = [
        {"key": b["key"], "label": b["label"], "status": b["status"], "detail": _fmt(b)}
        for b in all_breakers if b["key"] in active_codes or b["status"] != "OK"
    ]

    # master flag OFF → breakers don't gate (override); else RED iff halted.
    # RD-B7: a stale EVALUATION outranks OK — we cannot vouch for a reading we
    # cannot date. It does NOT outrank RED or OFF: a halt already latched is
    # still a halt, and an explicit override is still an override. Only the
    # all-clear degrades, because only the all-clear is the green lie.
    status = "OFF" if not enabled else ("RED" if not entries_allowed else "OK")
    if status == "OK" and last_eval_stale:
        status = "UNKNOWN"

    return {
        "overall_status": status,
        "override_active": (not enabled),
        "entries_allowed": entries_allowed,
        # RD-B7 freshness of the EVALUATION itself. `last_eval_at` is the absolute
        # UTC instant and is the load-bearing field: this payload is served through
        # a stale-while-revalidate cache (auto/profit-risk/route.ts), so a
        # server-computed age can FREEZE and keep looking fresh — a 16h48m-old body
        # was observed being served as current. Consumers recompute the displayed
        # age from `last_eval_at` against their own clock; `last_eval_age_s` is the
        # server's snapshot, kept for query_auto_state.py convention parity.
        "last_eval_at": last_eval_at,
        "last_eval_age_s": last_eval_age_s,
        "last_eval_stale": last_eval_stale,
        "last_eval_stale_after_s": BREAKER_EVAL_STALE_S,
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
                "last_eval_at": None, "last_eval_age_s": None,
                "last_eval_stale": True,
                "last_eval_stale_after_s": BREAKER_EVAL_STALE_S,
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
                         "entries_allowed": False, "active": [], "all": [],
                         "last_eval_at": None, "last_eval_age_s": None,
                         "last_eval_stale": True,
                         "last_eval_stale_after_s": BREAKER_EVAL_STALE_S},
        }))
        _sys_wrap.exit(0)
