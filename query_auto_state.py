#!/usr/bin/env python3
"""
Consolidated AUTO state for /api/auto/state.

RM-PNL P01 (2026-05-29): REALIZED-ONLY headline P&L model.

  THE MODEL (intentional, non-standard — see Hub CLAUDE.md preference):
  - Headline P&L = REALIZED only. A closed trade's `pnl_usd` is the only thing
    that moves a realized total. An OPEN position contributes $0 to every
    realized window regardless of its floating gain/loss; its committed
    notional is deployed capital, NOT P&L. Unrealized NEVER enters any
    realized number.
  - `realized` is bucketed across 5 windows — today / yesterday / week / month
    / all — on EASTERN-CALENDAR boundaries (closed_at is stored UTC; we compute
    ET-midnight boundaries via zoneinfo and convert to UTC for comparison).
  - `unrealized_usd` = live HL floating PnL of open positions — a SEPARATE,
    de-emphasized ("greyed") field for the UI only. It is never summed into a
    realized total.
  - `open_exposure_usd` = sum of committed notional of open positions — neutral
    deployed capital, never P&L.
  - `equity_usd` = live HL `accountValue` (perps margin + unrealized) + spot
    USDC — the factual account value, shown as-is. It floats with open
    positions BY DESIGN; the UI labels it "live account value", distinct from
    the realized booked number.
  - `realized_unknown_count` = closed live rows with a NULL `pnl_usd` (older
    `external_close` flattens that never booked a number). Surfaced, never
    silently invented or dropped.

RM-07 P00/P01 (2026-05-28): `equity` is the LIVE Hyperliquid unified balance
(perps `accountValue` + spot USDC). `live_capital_usd` hardcoded 0 (cap gone).

Legacy fields (`pnl_today_usd`, `pnl_today_pct`, `trades_today`, `equity`,
`open_positions_count`, `trades_total`, auto/live/killswitch flags) are
preserved for back-compat. `pnl_today_usd` now equals `realized.today`
(ET-calendar) — it was a rolling-24h-UTC window pre-P01; the ET-calendar
semantics are the intended fix.

Notes:
- READ-ONLY (`file:...?mode=ro`) for SQL paths; HL fetch is a network call.
- `per_ticker_thresholds_enabled` is read at runtime from
  /home/trevor/trevor/ticker_thresholds.py — no hardcoded drift.
- `realized_pct[w]` base = current live equity (`equity_usd`); collapses to 0
  when HL is unreachable. This is the only honest base available — the Hub
  stores no historical equity snapshots, so a true per-window "% of equity at
  window start" is not computable. (Future infra: daily equity snapshot.)
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

DB = "/home/trevor/trevor/trevor.db"
ET = ZoneInfo("America/New_York")
UTC = timezone.utc


def _fetch_hl() -> dict | None:
    """Read live HL state in ONE round-trip — UNIFIED balance + unrealized PnL.

    RM-PNL P01 (2026-05-29): extends the prior `_fetch_hl_account_value` to also
    return `unrealized` (sum of `assetPositions[].position.unrealizedPnl`) from
    the SAME `user_state` call — no extra outbound request. Reuses the only HL
    fetch in the Hub (per the no-new-outbound-call constraint).

    RM-07 P01 (2026-05-28): `equity` = `marginSummary.accountValue` (perps margin
    + unrealized PnL) + spot USDC.total — Hyperliquid "unified account" semantics
    (USDC migrates between spot and perps margin as trades open/close; the sum is
    constant modulo realized PnL).

    Returns {"equity": float, "unrealized": float} or None on any failure.
    Note `equity` already includes `unrealized` (mark-to-market) — `unrealized`
    is broken out so the UI can show the booked-vs-floating split and label
    equity as the floating "live account value".
    """
    try:
        # Bot venv has hyperliquid + python-dotenv installed
        sys.path.insert(0, "/home/trevor/trevor")
        from dotenv import load_dotenv  # type: ignore[import-not-found]
        from hyperliquid.info import Info  # type: ignore[import-not-found]
        from hyperliquid.utils import constants  # type: ignore[import-not-found]

        load_dotenv("/home/trevor/trevor/.env")
        addr = (
            os.getenv("HL_WALLET_ADDRESS")
            or os.getenv("HL_ADDRESS")
            or os.getenv("HL_ACCOUNT_ADDRESS")
        )
        if not addr:
            return None
        info = Info(constants.MAINNET_API_URL, skip_ws=True)

        # Perps margin + unrealized PnL
        state = info.user_state(addr)
        margin = state.get("marginSummary", {})
        perps_value = float(margin.get("accountValue", 0.0))

        # Unrealized = sum of floating PnL across open perp positions (greyed line)
        unrealized = 0.0
        for ap in state.get("assetPositions", []) or []:
            pos = (ap or {}).get("position", {}) or {}
            try:
                unrealized += float(pos.get("unrealizedPnl", 0.0) or 0.0)
            except (TypeError, ValueError):
                continue

        # Spot USDC total
        spot_usdc = 0.0
        try:
            spot_state = info.spot_user_state(addr)
            for bal in spot_state.get("balances", []) or []:
                if (bal or {}).get("coin") == "USDC":
                    spot_usdc = float(bal.get("total", 0.0) or 0.0)
                    break
        except Exception:
            spot_usdc = 0.0

        return {"equity": perps_value + spot_usdc, "unrealized": unrealized}
    except Exception:
        return None


def _et_window_starts(now_utc: datetime) -> dict:
    """ET-calendar window-start boundaries, returned as UTC-naive
    'YYYY-MM-DD HH:MM:SS' strings to compare against the UTC `closed_at` column.

    today      = ET-midnight of the current ET day
    yesterday  = [prev ET-midnight, today ET-midnight)   (a RANGE, not open-ended)
    week       = ET-midnight 6 days before today (rolling 7-day incl. today)
    month      = ET-midnight 29 days before today (rolling 30-day incl. today)
    """
    now_et = now_utc.astimezone(ET)
    today0 = now_et.replace(hour=0, minute=0, second=0, microsecond=0)

    def u(dt_et: datetime) -> str:
        return dt_et.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S")

    return {
        "today": u(today0),
        "yesterday": u(today0 - timedelta(days=1)),
        "week": u(today0 - timedelta(days=6)),
        "month": u(today0 - timedelta(days=29)),
    }


def compute_windows(rows, now_utc: datetime) -> dict:
    """Bucket closed-LIVE trades into realized windows on ET-calendar boundaries.

    `rows`: iterable of (closed_at_str_UTC, pnl_usd_or_None). REALIZED ONLY —
    callers pass closed live rows; this function never sees open positions or
    unrealized PnL, so no realized total can ever include floating P&L.

    Returns {realized:{...}, realized_count:{...}, realized_unknown_count:int}.
    NULL-pnl rows are counted toward `realized_unknown_count` and excluded from
    every sum (we never fabricate a number for a close that didn't book one).
    String comparison on the zero-padded 'YYYY-MM-DD HH:MM:SS' UTC format is
    chronologically correct.
    """
    b = _et_window_starts(now_utc)
    sums = {"today": 0.0, "yesterday": 0.0, "week": 0.0, "month": 0.0, "all": 0.0}
    counts = {"today": 0, "yesterday": 0, "week": 0, "month": 0, "all": 0}
    unknown = 0

    for closed_at, pnl in rows:
        if closed_at is None:
            continue
        if pnl is None:
            unknown += 1
            continue
        pnl = float(pnl)
        # All windows
        sums["all"] += pnl
        counts["all"] += 1
        if closed_at >= b["month"]:
            sums["month"] += pnl
            counts["month"] += 1
        if closed_at >= b["week"]:
            sums["week"] += pnl
            counts["week"] += 1
        if closed_at >= b["today"]:
            sums["today"] += pnl
            counts["today"] += 1
        elif closed_at >= b["yesterday"]:  # [yesterday, today)
            sums["yesterday"] += pnl
            counts["yesterday"] += 1

    return {
        "realized": {k: round(v, 4) for k, v in sums.items()},
        "realized_count": counts,
        "realized_unknown_count": unknown,
    }


def _connect_ro() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10)


def _per_ticker_enabled() -> bool:
    """Runtime import — no hardcoded drift. Matches query_auto_per_ticker_thresholds.py."""
    try:
        sys.path.insert(0, "/home/trevor/trevor")
        import ticker_thresholds as tt  # type: ignore[import-not-found]
        return bool(getattr(tt, "PER_TICKER_THRESHOLDS_ENABLED", False))
    except Exception:
        return False


def main() -> int:
    out = {
        # --- realized-only P&L model (RM-PNL P01) ---
        "equity_usd": 0.0,
        "realized": {"today": 0.0, "yesterday": 0.0, "week": 0.0, "month": 0.0, "all": 0.0},
        "realized_pct": {"today": 0.0, "yesterday": 0.0, "week": 0.0, "month": 0.0, "all": 0.0},
        "realized_count": {"today": 0, "yesterday": 0, "week": 0, "month": 0, "all": 0},
        "realized_unknown_count": 0,
        "open_exposure_usd": 0.0,
        "unrealized_usd": 0.0,
        "open_count": 0,
        # --- legacy / shared fields (back-compat) ---
        "capital_usd": 0.0,
        "live_capital_usd": 0.0,
        "equity": 0.0,
        "pnl_today_usd": 0.0,
        "pnl_today_pct": 0.0,
        "trades_today": 0,
        "trades_total": 0,
        "open_positions_count": 0,
        "auto_enabled": False,
        "live_enabled": False,
        "killswitch_on": False,
        "per_ticker_thresholds_enabled": False,
        "data_available": False,
    }

    if not Path(DB).exists():
        out["error"] = f"DB not found: {DB}"
        sys.stdout.write(json.dumps(out))
        return 1

    try:
        with _connect_ro() as conn:
            conn.row_factory = sqlite3.Row

            cfg_rows = conn.execute(
                """
                SELECT key, value FROM auto_config
                WHERE key IN (
                    'AUTO_TRADER_ENABLED', 'AUTO_LIVE_ENABLED',
                    'EMERGENCY_KILLSWITCH'
                )
                """
            ).fetchall()
            cfg = {r["key"]: r["value"] for r in cfg_rows}

            # REALIZED source: every closed LIVE trade (closed_at UTC + pnl_usd).
            # Bucketed in Python on ET-calendar boundaries. Paper trades excluded.
            closed_rows = conn.execute(
                "SELECT closed_at, pnl_usd FROM auto_trades "
                "WHERE trade_mode='live' AND status='closed'"
            ).fetchall()

            # OPEN exposure = committed notional of currently-open positions
            # (BOTH live + paper opens, matching the existing open-count tile).
            open_row = conn.execute(
                "SELECT COUNT(*) AS n, COALESCE(SUM(notional_usd), 0) AS notional "
                "FROM auto_trades WHERE status='open'"
            ).fetchone()

            total_count_row = conn.execute(
                "SELECT COUNT(*) AS n FROM auto_trades WHERE status='closed'"
            ).fetchone()

        now_utc = datetime.now(UTC)
        win = compute_windows(
            ((r["closed_at"], r["pnl_usd"]) for r in closed_rows), now_utc
        )
        realized = win["realized"]

        # RM-07 P01: live HL unified balance for equity + unrealized (greyed line).
        # On HL unreachable, equity falls back to DB realized.all (no cap anchor);
        # unrealized degrades to 0 (we can't mark-to-market without HL).
        hl = _fetch_hl()
        if hl is not None:
            equity = round(hl["equity"], 4)
            unrealized = round(hl["unrealized"], 4)
        else:
            equity = realized["all"]
            unrealized = 0.0

        # realized_pct[w] = realized[w] / current live equity * 100.
        # Base = current equity (the only honest base — no equity-snapshot
        # history exists). Collapses to 0 when equity <= 0 (HL unreachable).
        realized_pct = {
            k: (round((v / equity) * 100.0, 4) if equity > 0 else 0.0)
            for k, v in realized.items()
        }

        open_count = int(open_row["n"] or 0)
        out.update({
            "equity_usd": equity,
            "realized": realized,
            "realized_pct": realized_pct,
            "realized_count": win["realized_count"],
            "realized_unknown_count": win["realized_unknown_count"],
            "open_exposure_usd": round(float(open_row["notional"] or 0.0), 4),
            "unrealized_usd": unrealized,
            "open_count": open_count,
            # --- legacy / shared back-compat ---
            "capital_usd": 0.0,             # vestigial; no starting-capital concept
            "live_capital_usd": 0.0,        # vestigial; collapses Hub "of $X cap" line
            "equity": equity,              # alias of equity_usd
            "pnl_today_usd": realized["today"],          # now ET-calendar (was rolling-24h)
            "pnl_today_pct": realized_pct["today"],
            "trades_today": win["realized_count"]["today"],
            "trades_total": int(total_count_row["n"] or 0),
            "open_positions_count": open_count,
            "auto_enabled":  str(cfg.get("AUTO_TRADER_ENABLED", "false")).lower() == "true",
            "live_enabled":  str(cfg.get("AUTO_LIVE_ENABLED", "false")).lower() == "true",
            "killswitch_on": str(cfg.get("EMERGENCY_KILLSWITCH", "false")).lower() == "true",
            "per_ticker_thresholds_enabled": _per_ticker_enabled(),
            "data_available": True,
        })

        sys.stdout.write(json.dumps(out))
        return 0
    except Exception as exc:
        out["error"] = f"{type(exc).__name__}: {exc}"
        sys.stdout.write(json.dumps(out))
        return 1


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
