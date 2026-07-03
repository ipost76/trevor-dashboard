#!/usr/bin/env python3
"""
Consolidated AUTO state for /api/auto/state.

RM-PNL P01 (2026-05-29): REALIZED-ONLY headline P&L model.

  THE MODEL (intentional, non-standard — see Hub CLAUDE.md preference):
  - Headline P&L = REALIZED only. A closed trade's realized total =
    `pnl_usd` (final-leg net) + `partial_pnl_realized` (banked scale-out
    profits) — NON-overlapping fractions, so summing both never
    double-counts (NUM-B1, 2026-06-21; the final close excludes already-banked
    partials). An OPEN position contributes $0 to every realized window
    regardless of its floating gain/loss; its committed notional is deployed
    capital, NOT P&L. Unrealized NEVER enters any realized number.
  - `realized` is bucketed across 5 windows — today / yesterday / week / month
    / all — on EASTERN-CALENDAR boundaries (closed_at is stored UTC; we compute
    ET-midnight boundaries via zoneinfo and convert to UTC for comparison).
  - `unrealized_usd` = live HL floating PnL of open positions — a SEPARATE,
    de-emphasized ("greyed") field for the UI only. It is never summed into a
    realized total.
  - `open_exposure_usd` = sum of committed notional of open positions — neutral
    deployed capital, never P&L.
  - `equity_usd` = live HL MTM equity = spot USDC `total` (honest cash) + Σ
    unrealized PnL (EQF-01 2026-06-04: perps `accountValue` is the spot-USDC
    HELD margin, already inside spot `total` — adding them double-counted).
    It floats with open positions BY DESIGN; the UI labels it "live account
    value" and de-floats it (− unrealized) to the realized booked number.
  - `realized_unknown_count` = closed live rows with a NULL `pnl_usd` (older
    `external_close` flattens that never booked a number). Surfaced, never
    silently invented or dropped.

EQF-01 (2026-06-04): `equity` = spot USDC `total` + Σ unrealized PnL (MTM). The
old perps `accountValue` + spot USDC double-counted the held isolated margin.
`live_capital_usd` hardcoded 0 (cap gone).

Legacy fields (`pnl_today_usd`, `pnl_today_pct`, `trades_today`, `equity`,
`open_positions_count`, `trades_total`, auto/live/killswitch flags) are
preserved for back-compat. `pnl_today_usd` now equals `realized.today`
(ET-calendar) — it was a rolling-24h-UTC window pre-P01; the ET-calendar
semantics are the intended fix.

Notes:
- READ-ONLY (`file:...?mode=ro`) for SQL paths; HL fetch is a network call.
- `per_ticker_thresholds_enabled` is read at runtime from
  /home/trevor/trevor/ticker_thresholds.py — no hardcoded drift.
- `realized_pct[w]` base = the account's realized-basis equity at the START of
  window `w` (WA-P1 2026-06-12), read from the `equity_snapshots` series
  (`realized_equity`, de-floated per EQT-W1; COALESCE to legacy `equity` for
  pre-EQT-W1 rows). Each window's % is therefore a true return over its own span
  — NOT every window divided by the current live equity (the old bug that
  produced impossible figures like ALL = −133%). HL-INDEPENDENT (the base is the
  snapshot series, not the live HL fetch). A missing/≤floor base → None → the UI
  renders "—". `realized_base[w]` exposes the base used, per window.

WA-P2 (2026-06-12): optional CUSTOM date-range window. When the script is invoked
with two argv dates (start, end 'YYYY-MM-DD'), it adds a `custom` key to
`realized` / `realized_pct` / `realized_base` / `realized_count`, computed through
the SAME compute path (ET-bucketed span + get_equity_at denominator). No args →
no `custom` key (byte-identical to the preset-only response). Custom only DEFINES
a (start, end); it adds NO new P&L or denominator math.
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

# WA-P1 (PCT-D2): floor below which a start-of-window equity base is unusable —
# the window % renders "—" rather than dividing by a near-zero base (no garbage %,
# never a divide-by-zero).
EQUITY_BASE_FLOOR = 1.0


def _fetch_hl() -> dict | None:
    """Read live HL state in ONE round-trip — UNIFIED balance + unrealized PnL.

    RM-PNL P01 (2026-05-29): extends the prior `_fetch_hl_account_value` to also
    return `unrealized` (sum of `assetPositions[].position.unrealizedPnl`) from
    the SAME `user_state` call — no extra outbound request. Reuses the only HL
    fetch in the Hub (per the no-new-outbound-call constraint).

    EQF-01 (2026-06-04): `equity` = spot USDC.total (honest cash) + Σ unrealized
    PnL = true MTM equity. The perps `marginSummary.accountValue` is the spot
    USDC HELD margin (already inside spot total), so the old
    `accountValue + spot total` double-counted the held margin.

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

        # EQF-01: honest cash is spot USDC `total`; the perps
        # `marginSummary.accountValue` is the spot-USDC HELD margin (already
        # inside spot total), so it's no longer read into the equity formula.
        state = info.user_state(addr)

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

        # EQF-01: MTM equity = honest cash (spot total) + floating PnL.
        return {"equity": spot_usdc + unrealized, "unrealized": unrealized}
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

    `rows`: iterable of (closed_at_str_UTC, pnl_usd_or_None,
    partial_pnl_realized_or_None). REALIZED ONLY — callers pass closed live
    rows; this function never sees open positions or unrealized PnL, so no
    realized total can ever include floating P&L.

    NUM-B1/B3 (2026-06-21): each row's realized contribution =
    `pnl_usd` (final-leg net) + `partial_pnl_realized` (banked scale-out
    profits, COALESCE NULL→0). A row is counted toward
    `realized_unknown_count` and excluded from every sum ONLY when it booked
    no number at all (pnl_usd NULL *and* partial null/zero); a row with a
    banked partial but a NULL final leg still contributes its partial.

    Returns {realized:{...}, realized_count:{...}, realized_unknown_count:int}.
    String comparison on the zero-padded 'YYYY-MM-DD HH:MM:SS' UTC format is
    chronologically correct.
    """
    b = _et_window_starts(now_utc)
    sums = {"today": 0.0, "yesterday": 0.0, "week": 0.0, "month": 0.0, "all": 0.0}
    counts = {"today": 0, "yesterday": 0, "week": 0, "month": 0, "all": 0}
    unknown = 0

    for closed_at, pnl, partial in rows:
        if closed_at is None:
            continue
        # NUM-B1/B3: realized = final-leg pnl_usd + banked scale-out partials.
        # COALESCE the partial to 0; a row is "unknown" (no booked number)
        # ONLY when pnl_usd is NULL *and* the partial is null/zero. A row with
        # a banked partial but a NULL final leg still contributes its partial.
        partial = float(partial) if partial is not None else 0.0
        if pnl is None and partial == 0.0:
            unknown += 1
            continue
        realized = (float(pnl) if pnl is not None else 0.0) + partial
        # All windows
        sums["all"] += realized
        counts["all"] += 1
        if closed_at >= b["month"]:
            sums["month"] += realized
            counts["month"] += 1
        if closed_at >= b["week"]:
            sums["week"] += realized
            counts["week"] += 1
        if closed_at >= b["today"]:
            sums["today"] += realized
            counts["today"] += 1
        elif closed_at >= b["yesterday"]:  # [yesterday, today)
            sums["yesterday"] += realized
            counts["yesterday"] += 1

    return {
        "realized": {k: round(v, 4) for k, v in sums.items()},
        "realized_count": counts,
        "realized_unknown_count": unknown,
    }


def _parse_custom_args(argv) -> tuple[str, str] | None:
    """Map two picked dates (argv: [start, end], 'YYYY-MM-DD') → an ET-bucketed
    (start_ts, end_ts) UTC span (WA-P2). start = ET-midnight(start day); end =
    ET-midnight(end day + 1), EXCLUSIVE — the SAME boundary convention the presets
    use (see _et_window_starts). Single-day (start == end) → exactly that one ET
    day. zoneinfo handles DST at the midnight boundary.

    Returns (start_ts_utc, end_ts_utc) or None when absent / malformed / end<start
    — the caller then emits NO `custom` window (never a garbage span). NO new P&L
    math: this only defines a (start, end), exactly like the preset bucketing.
    """
    if len(argv) < 2:
        return None
    try:
        sd = datetime.strptime(argv[0], "%Y-%m-%d").date()
        ed = datetime.strptime(argv[1], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None
    if ed < sd:
        return None
    # WA-P2: no future dates (defense-in-depth — the UI also caps both inputs at
    # ET-today via max=). end > ET-today rejects any range that touches the future;
    # end == ET-today is allowed (a range ending today is valid).
    if ed > datetime.now(UTC).astimezone(ET).date():
        return None
    start_et = datetime(sd.year, sd.month, sd.day, tzinfo=ET)
    end_et = datetime(ed.year, ed.month, ed.day, tzinfo=ET) + timedelta(days=1)
    return (
        start_et.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S"),
        end_et.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S"),
    )


def compute_custom(rows, start_ts: str, end_ts: str) -> dict:
    """Realized P&L over an ARBITRARY [start_ts, end_ts) span (WA-P2).

    SAME numerator rule as compute_windows (NUM-B2/B3) — each row's realized =
    `pnl_usd` (final-leg net) + `partial_pnl_realized` (banked scale-out
    profits, COALESCE NULL→0); a row is "unknown" and excluded ONLY when it
    booked no number at all (pnl_usd NULL *and* partial null/zero). `end_ts` is
    EXCLUSIVE (ET-midnight of end-day+1), so the boundary convention matches the
    presets exactly (a custom 'last 7 days' is byte-identical to the 1W preset).
    NO new P&L math — just a different (start, end) than the preset buckets.

    Returns {realized: float, count: int, unknown: int}.
    """
    s = 0.0
    cnt = 0
    unknown = 0
    for closed_at, pnl, partial in rows:
        if closed_at is None:
            continue
        if not (start_ts <= closed_at < end_ts):
            continue
        # NUM-B2/B3: same numerator rule as compute_windows — sum
        # pnl_usd + banked partials; "unknown" ONLY when pnl_usd is NULL
        # *and* the partial is null/zero.
        partial = float(partial) if partial is not None else 0.0
        if pnl is None and partial == 0.0:
            unknown += 1
            continue
        s += (float(pnl) if pnl is not None else 0.0) + partial
        cnt += 1
    return {"realized": round(s, 4), "count": cnt, "unknown": unknown}


def _connect_ro() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10)


def _cutover_epoch(conn: sqlite3.Connection) -> str:
    """V2 cutover epoch (B3): UTC 'YYYY-MM-DD HH:MM:SS' floor for every
    historical (closed-trade) read. Reads the SAME `auto_config` key B2 set
    (`AUTO_CUTOVER_EPOCH`). FAIL-CLOSED: a missing/unreadable/unparseable key
    returns now(UTC) — show fresh, never dump pre-cutover history back. Old
    rows stay archived in `auto_trades`; lower/drop the key to un-hide them.
    """
    try:
        row = conn.execute(
            "SELECT value FROM auto_config WHERE key='AUTO_CUTOVER_EPOCH'"
        ).fetchone()
        raw = str(row[0]).strip() if row is not None else ""
        datetime.strptime(raw, "%Y-%m-%d %H:%M:%S")  # validate or fail-closed
        return raw
    except Exception:
        return datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")


def get_equity_at(conn: sqlite3.Connection, window_start_ts: str | None) -> float | None:
    """Realized-basis account equity at the START of a window (WA-P1 PCT-D1/D2).

    Returns the most recent `equity_snapshots` realized-basis value with
    `ts <= window_start_ts`. Realized basis = `realized_equity` (de-floated per
    EQT-W1); for pre-EQT-W1 rows where `realized_equity` is NULL we COALESCE to
    the legacy `equity` (at those early points float≈0, so MTM≈realized — the
    honest "start" base).

    Fallback (PCT-D2): if no snapshot exists at/before the window start (the
    window opens before the series begins, e.g. 1M when history is <30d old),
    use the NEAREST snapshot AFTER it — the earliest available equity. Returns
    None only when the table is empty or `window_start_ts` is None; the caller
    renders "—" rather than dividing by a missing base.

    Read-only: reuses the caller's `mode=ro` connection, parameterized query,
    error-handled. NEVER writes.
    """
    if window_start_ts is None:
        return None
    try:
        row = conn.execute(
            "SELECT COALESCE(realized_equity, equity) "
            "FROM equity_snapshots WHERE ts <= ? ORDER BY ts DESC LIMIT 1",
            (window_start_ts,),
        ).fetchone()
        if row is None:  # window opens before the series — nearest snapshot AFTER
            row = conn.execute(
                "SELECT COALESCE(realized_equity, equity) "
                "FROM equity_snapshots WHERE ts > ? ORDER BY ts ASC LIMIT 1",
                (window_start_ts,),
            ).fetchone()
        if row is None or row[0] is None:
            return None
        return float(row[0])
    except Exception:
        return None


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
        "realized_pct": {"today": None, "yesterday": None, "week": None, "month": None, "all": None},
        "realized_base": {"today": None, "yesterday": None, "week": None, "month": None, "all": None},
        # C2 (2026-07-02): account value at AUTO_CUTOVER_EPOCH — route.ts's fixed
        # realized-% denominator. None → the route renders every % as "—".
        "cutover_base_usd": None,
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

            # V2 cutover epoch (B3): both HISTORICAL reads below (closed_rows +
            # total_count_row) are floored at the epoch. closed_at is a UTC
            # 'YYYY-MM-DD HH:MM:SS' string, so string >= is chronological.
            epoch = _cutover_epoch(conn)

            # C2 (2026-07-02): account value AT the cutover epoch — the fixed
            # denominator route.ts divides every realized window by (replaces
            # the BASE-B2 lifetime-net-deposits base, which died with the V2
            # wallet migration). equity_snapshots is append-only and the epoch
            # is fixed, so this nearest-at-or-before read returns the same
            # figure every request — a fixed base with zero stored state.
            # None (empty table / read error) → route renders "—" (fail-open).
            cutover_base = get_equity_at(conn, epoch)

            # REALIZED source: every closed LIVE trade (closed_at UTC + pnl_usd).
            # Bucketed in Python on ET-calendar boundaries. Paper trades excluded.
            closed_rows = conn.execute(
                "SELECT closed_at, pnl_usd, partial_pnl_realized FROM auto_trades "
                "WHERE trade_mode='live' AND status='closed' AND closed_at >= ?",
                (epoch,),
            ).fetchall()

            # OPEN exposure = committed notional of currently-open positions
            # (BOTH live + paper opens, matching the existing open-count tile).
            open_row = conn.execute(
                "SELECT COUNT(*) AS n, COALESCE(SUM(notional_usd), 0) AS notional "
                "FROM auto_trades WHERE status='open'"
            ).fetchone()

            total_count_row = conn.execute(
                "SELECT COUNT(*) AS n FROM auto_trades WHERE status='closed' "
                "AND closed_at >= ?",
                (epoch,),
            ).fetchone()

            # WA-P1 (PCT-D1/D2) + PCT-DENOM-FIX B1 (2026-07-03): start-of-window
            # realized-basis equity per window, read inside the SAME mode=ro
            # connection. Each window's % divides its realized P&L by the account
            # equity at that window's START (not the current live equity), so it's
            # a true return over the window's span. Every window start is FLOORED
            # at the cutover epoch (max(start, epoch)) so the denominator matches
            # the numerator — which is already epoch-floored (closed_rows WHERE
            # closed_at >= epoch). A window opening before the cutover (1M today,
            # an old CUSTOM span) clamps up to the epoch and uses the cutover base,
            # keeping numerator + denominator on the same window with the base
            # always defined. ALL anchors DIRECTLY to the epoch (was the earliest
            # snapshot ts = the drained OLD-wallet ~$70.91 — the BASE bug the
            # route override was masking). None for any window whose base is
            # missing → UI renders "—".
            now_utc = datetime.now(UTC)
            starts = _et_window_starts(now_utc)
            base_starts = {
                "today": max(starts["today"], epoch),
                "yesterday": max(starts["yesterday"], epoch),
                "week": max(starts["week"], epoch),
                "month": max(starts["month"], epoch),
                "all": epoch,
            }
            realized_base = {
                k: get_equity_at(conn, ts) for k, ts in base_starts.items()
            }

            # WA-P2 (2026-06-12): optional custom date-range window. The two picked
            # dates arrive as argv (start, end 'YYYY-MM-DD'); _parse_custom_args maps
            # them to an ET-bucketed (start_ts, end_ts) span. Its start-of-window base
            # is read by the SAME get_equity_at (A-P1's denominator) inside this SAME
            # mode=ro connection — zero new denominator math.
            custom_span = _parse_custom_args(sys.argv[1:])
            # PCT-DENOM-FIX B1: floor the custom span's start at the cutover epoch
            # too, so a range reaching before the cutover uses the cutover base
            # (matches the epoch-floored numerator).
            custom_base = (
                get_equity_at(conn, max(custom_span[0], epoch)) if custom_span else None
            )

        win = compute_windows(
            (
                (r["closed_at"], r["pnl_usd"], r["partial_pnl_realized"])
                for r in closed_rows
            ),
            now_utc,
        )
        realized = win["realized"]

        # WA-P2: fold the custom window into the SAME realized / realized_base /
        # realized_count dicts BEFORE the realized_pct loop below, so its % is
        # computed by the same code path as the presets (no separate calc).
        if custom_span is not None:
            cwin = compute_custom(
                (
                    (r["closed_at"], r["pnl_usd"], r["partial_pnl_realized"])
                    for r in closed_rows
                ),
                custom_span[0],
                custom_span[1],
            )
            realized["custom"] = cwin["realized"]
            realized_base["custom"] = custom_base
            win["realized_count"]["custom"] = cwin["count"]
            out["realized_custom_unknown_count"] = cwin["unknown"]

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

        # WA-P1 (PCT-D1/D2): realized_pct[w] = realized[w] / start-of-window
        # realized-basis equity * 100 — HL-INDEPENDENT (the base is the
        # equity_snapshots series, not the live HL equity). A missing or ≤floor
        # base yields None (UI renders "—"), never a divide-by-zero or garbage %.
        realized_pct = {}
        for k, v in realized.items():
            base = realized_base.get(k)
            realized_pct[k] = (
                round((v / base) * 100.0, 4)
                if base is not None and base > EQUITY_BASE_FLOOR
                else None
            )

        open_count = int(open_row["n"] or 0)
        out.update({
            "equity_usd": equity,
            "realized": realized,
            "realized_pct": realized_pct,
            "realized_base": realized_base,
            "cutover_base_usd": cutover_base,  # C2: fixed cutover-epoch base
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
            # legacy/dead field (no consumer): keep numeric — None base → 0.0
            "pnl_today_pct": realized_pct["today"] if realized_pct["today"] is not None else 0.0,
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
