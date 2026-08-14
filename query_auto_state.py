#!/usr/bin/env python3
"""
Consolidated AUTO state for /api/auto/state.

🚨 TWO-CLOCK RULE (B1-ET-DAY-BOUNDARY, 2026-07-16) — LOAD-BEARING, do not mix:
  · `auto_trades.closed_at` / `opened_at`  = naive EASTERN wall-clock
    (`datetime.now()` on the ET VM). Compare these against RAW ET-calendar
    strings — NEVER convert to UTC. (created_at == opened_at + 4h proves it.)
  · `auto_trades.created_at`                = real UTC (SQLite CURRENT_TIMESTAMP).
  · `equity_snapshots.ts`                   = real UTC.
  · `auto_config.*.updated_at`              = real UTC.
  This file compares BOTH clocks: `_et_window_starts` builds naive-ET boundaries
  for the `closed_at` buckets (compute_windows / compute_custom); the SEPARATE
  `_utc_window_starts` builds UTC boundaries for the equity BASE (get_equity_at →
  equity_snapshots.ts). A boundary in the wrong clock silently shifts the day 4h
  (drops the 00:00–03:59-ET window from "today"). NEVER re-introduce an
  `.astimezone(UTC)` on a `closed_at`/`opened_at` boundary.

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
    / all — on EASTERN-CALENDAR boundaries. `closed_at` is naive Eastern (see the
    two-clock rule above), so we compare it against RAW ET-midnight strings — NO
    timezone conversion. (The equity BASE denominator is a separate UTC path.)
  - `unrealized_usd` = live HL floating PnL of open positions — a SEPARATE,
    de-emphasized ("greyed") field for the UI only. It is never summed into a
    realized total.
  - `open_margin_usd` = Σ `auto_trades.notional_usd` over open positions — the
    POSTED MARGIN (deployed capital), neutral, never P&L. 🚨 This is NOT
    leveraged exposure: `notional_usd` IS the margin (see the landmine block in
    `query_leverage_regime.py`); true notional = margin × leverage, which
    measures ~13× larger on this book. Renamed from `open_exposure_usd`
    (RF3T2-B5, 2026-07-24) — the old key claimed exposure while computing margin.
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

from lib.paper_mode import is_paper_sql

DB = "/home/trevor/trevor/trevor.db"
ET = ZoneInfo("America/New_York")
UTC = timezone.utc

# WA-P1 (PCT-D2): floor below which a start-of-window equity base is unusable —
# the window % renders "—" rather than dividing by a near-zero base (no garbage %,
# never a divide-by-zero).
EQUITY_BASE_FLOOR = 1.0

# RM-EQUITY-RESTORE B1 (2026-07-11): staleness ceiling for the LIVE account-value
# display. The bot writes auto_config.LIVE_ACCOUNT_VALUE_USD every ~5-min monitor
# cycle (reusing the drift-check's already-fetched HL equity — display-only, NOT a
# new HL call), but the Hub reads a ~20-min tailsync replica, so a HEALTHY value is
# routinely 25-30 min old (writer gap + replica sync lag). 2700s (~2× replica
# cadence + writer cadence + grace) blanks the card to "—" only when the writer OR
# the sync is genuinely dead ≥45 min — it never false-blanks a healthy pipeline. A
# tighter gate (e.g. 900s) would render "—" most of the time on a healthy system.
LIVE_ACCOUNT_VALUE_STALE_S = 2700


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
    """ET-calendar window-start boundaries as NAIVE-EASTERN 'YYYY-MM-DD HH:MM:SS'
    strings, compared LEXICALLY against the naive-Eastern `closed_at` column — NO
    timezone conversion (closed_at is ET wall-clock; see the two-clock rule at the
    top of this file). Mirrors query_auto_trades._range_bounds: pure ET calendar-
    date arithmetic (`date + timedelta`), so a DST transition inside the window
    never drifts the wall-clock boundary off midnight.

    🚨 For the `closed_at` buckets ONLY (compute_windows). The equity BASE
    denominator uses the SEPARATE `_utc_window_starts` (equity_snapshots.ts is UTC).

    today      = ET-midnight of the current ET day
    yesterday  = [prev ET-midnight, today ET-midnight)   (a RANGE, not open-ended)
    week       = ET-midnight 6 days before today (rolling 7-day incl. today)
    month      = ET-midnight 29 days before today (rolling 30-day incl. today)
    """
    today = now_utc.astimezone(ET).date()

    def et(d) -> str:  # a date -> its ET-midnight naive string
        return f"{d.isoformat()} 00:00:00"

    return {
        "today": et(today),
        "yesterday": et(today - timedelta(days=1)),
        "week": et(today - timedelta(days=6)),
        "month": et(today - timedelta(days=29)),
    }


def _utc_window_starts(now_utc: datetime) -> dict:
    """UTC instants of each ET-midnight window start, as naive-UTC
    'YYYY-MM-DD HH:MM:SS' strings — for the equity BASE ONLY (get_equity_at reads
    `equity_snapshots.ts`, which is REAL UTC; see the two-clock rule at the top).

    🚨 DO NOT feed these to any `closed_at`/`opened_at` comparison — those are
    naive Eastern (use `_et_window_starts`). ET-midnight of the current ET day is
    04:00 (EDT) / 05:00 (EST) UTC, so this is genuinely a different string than the
    ET boundary above; querying `equity_snapshots.ts <= <this>` returns the account
    equity at the real-world start of the ET window.
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

    `rows`: iterable of (closed_at_str_ET, pnl_usd_or_None,
    partial_pnl_realized_or_None). `closed_at` is naive EASTERN (two-clock rule);
    the window starts from `_et_window_starts` are naive ET too. REALIZED ONLY —
    callers pass closed live
    rows; this function never sees open positions or unrealized PnL, so no
    realized total can ever include floating P&L.

    NUM-B1/B3 (2026-06-21): each row's realized contribution =
    `pnl_usd` (final-leg net) + `partial_pnl_realized` (banked scale-out
    profits, COALESCE NULL→0). A row is counted toward
    `realized_unknown_count` and excluded from every sum ONLY when it booked
    no number at all (pnl_usd NULL *and* partial null/zero); a row with a
    banked partial but a NULL final leg still contributes its partial.

    Returns {realized:{...}, realized_count:{...}, realized_unknown_count:int}.
    Lexical comparison on the fixed-width 'YYYY-MM-DD HH:MM:SS' ET strings
    (window starts + closed_at, same naive-ET clock) is chronologically correct.
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


def _parse_custom_args(
    argv,
) -> tuple[tuple[str, str], tuple[str, str]] | None:
    """Map two picked dates (argv: [start, end], 'YYYY-MM-DD') → a custom span,
    returned in BOTH clocks (WA-P2 + the two-clock rule at the top of this file):

        ((et_start, et_end), (utc_start, utc_end))

    · `et_*`  = naive-EASTERN 'YYYY-MM-DD HH:MM:SS' — for compute_custom, which
      buckets `closed_at` (naive Eastern). Pure ET calendar-date arithmetic,
      mirroring query_auto_trades._range_bounds (DST-safe, no wall-clock drift).
    · `utc_*` = the UTC instants of those same ET midnights — for the equity BASE
      only (get_equity_at → equity_snapshots.ts, real UTC).

    start = ET-midnight(start day); end = ET-midnight(end day + 1), EXCLUSIVE —
    the SAME boundary convention the presets use. Single-day (start == end) →
    exactly that one ET day.

    Returns None when absent / malformed / end<start — the caller then emits NO
    `custom` window (never a garbage span). NO new P&L math: this only defines a
    (start, end), exactly like the preset bucketing.
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
    # end == ET-today is allowed (a range ending today is valid). ET-date compare.
    if ed > datetime.now(UTC).astimezone(ET).date():
        return None
    # ET bounds → compute_custom (closed_at is naive Eastern; NO conversion).
    et_bounds = (
        f"{sd.isoformat()} 00:00:00",
        f"{(ed + timedelta(days=1)).isoformat()} 00:00:00",
    )
    # UTC bounds → the equity BASE only (equity_snapshots.ts is real UTC).
    start_et = datetime(sd.year, sd.month, sd.day, tzinfo=ET)
    end_et = datetime(ed.year, ed.month, ed.day, tzinfo=ET) + timedelta(days=1)
    utc_bounds = (
        start_et.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S"),
        end_et.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S"),
    )
    return (et_bounds, utc_bounds)


def compute_custom(rows, start_ts: str, end_ts: str) -> dict:
    """Realized P&L over an ARBITRARY [start_ts, end_ts) span (WA-P2).

    `start_ts`/`end_ts` are naive-EASTERN strings (the `et_bounds` from
    _parse_custom_args) compared LEXICALLY against the naive-Eastern `closed_at` —
    NO timezone conversion (two-clock rule). SAME numerator rule as compute_windows
    (NUM-B2/B3) — each row's realized = `pnl_usd` (final-leg net) +
    `partial_pnl_realized` (banked scale-out profits, COALESCE NULL→0); a row is
    "unknown" and excluded ONLY when it booked no number at all (pnl_usd NULL *and*
    partial null/zero). `end_ts` is EXCLUSIVE (ET-midnight of end-day+1), so the
    boundary convention matches the presets exactly (a custom 'last 7 days' is
    byte-identical to the 1W preset). NO new P&L math — just a different (start,
    end) than the preset buckets.

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


def _paper_window_state(cfg: dict) -> tuple[str, bool]:
    """W4a: resolve the EFFECTIVE trading mode into (state, is_paper).

    `cfg` is the already-fetched auto_config map, so a successful query with no
    `PAPER_WINDOW_ENABLED` row is distinguishable from a query that never ran.
    The caller supplies "error" on the exception path (the fail-safe out dict);
    this function only ever sees a SUCCESSFUL read.

      "on"     -> True   row present and EXACTLY 'true': the bot is paper-gated
      "off"    -> False  row present and EXACTLY 'false': the bot executes live
      "absent" -> True   NO USABLE VALUE — the row is missing, empty, or holds
                         something that is neither literal. UNCONFIRMABLE,
                         shown as PAPER? (never a bare LIVE, never a bare PAPER)

    🚨 ONLY THE TWO EXACT LITERALS ARE RECOGNISED. An earlier draft of this
    function mapped "anything not 'true'" to "off" — so a blank row, a 'yes', a
    '1', or a stray 'None' would have rendered a CONFIDENT LIVE badge off a
    value nobody could parse. That is the same false-confidence this whole
    change exists to remove, reintroduced one `else` clause deep. A value we
    cannot read is not evidence that the paper window is closed.

    🚨 "absent" deliberately does NOT mirror the VM's DEFAULTS (config.py:410
    maps an absent key to 'false' => the bot executes LIVE). Mirroring it here
    would let a silently-deleted row render a confident LIVE badge. It also must
    not render a confident PAPER: that would claim safety we cannot prove while
    real money moves. It renders as UNCONFIRMED, which is the only honest answer.

    NEVER hardcode a mode string against this — derive it (RP-C13's precedent).
    """
    raw = cfg.get("PAPER_WINDOW_ENABLED")
    if raw is None:
        return ("absent", True)
    normalized = str(raw).strip().lower()
    if normalized == "true":
        return ("on", True)
    if normalized == "false":
        return ("off", False)
    # Present but unreadable. Same honest answer as a missing row.
    return ("absent", True)


def _replica_age(now_utc: datetime) -> tuple[int | None, str | None, int | None]:
    """W4a: age of the published read-only replica, from the mtime of the file
    `DB` resolves to (on WSL, /home/trevor/trevor/trevor.db is a symlink to
    /home/ghost/trevor-replica/trevor.db — the tailsync-published copy).

    mtime is the right clock here, NOT MAX(created_at): the newest row answers
    "when did the bot last trade", which on a quiet day is legitimately hours
    old and would libel a perfectly fresh replica as stale. mtime answers "when
    was this data published", which is the question an empty screen raises.

    🚨 B2-RM-PROFIT (2026-08-14) — THE THIRD ELEMENT IS THE LOAD-BEARING ONE.
    `replica_age_seconds` (element 0) is a DURATION measured at the instant this
    payload was BUILT. That is a correct measurement and it is kept, but it is
    the wrong thing to render a freshness stamp from, because a duration cannot
    age. Any layer that holds this payload — the route's stale-while-revalidate
    cache, a suspended browser tab — keeps serving a duration that was true
    hours ago, and a stamp derived from it slides forward with the wall clock
    while claiming a constant lag. Measured on this box: a payload built
    2026-08-13 09:04:45 was served 2026-08-14 08:12:30 still carrying
    `replica_age_seconds=933`, a 23h07m-old page stamped 15 minutes.

    Element 2 is the ABSOLUTE watermark — the replica file's mtime as real UTC
    epoch SECONDS. It is a step function: it jumps when tailsync publishes and
    sits still between publishes, so `now - watermark` grows for exactly as long
    as the data is actually held, at whatever layer holds it. Emitted as an
    integer epoch, never a formatted string, so no consumer can re-parse it on
    the wrong clock (the naive `replica_mtime_utc` string beside it is real UTC
    but carries no offset, and `new Date(str)` in a browser reads it as LOCAL).

    Mirrors the `_replica_age` idiom already used by drift-state/route.ts and
    query_shadow_registry. Fails to (None, None, None) — the Hub then renders
    UNKNOWN, never a fabricated claim and never a healthy-looking default.
    """
    try:
        st = os.stat(os.path.realpath(DB))
        return (
            max(0, int(now_utc.timestamp() - st.st_mtime)),
            datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).strftime(
                "%Y-%m-%d %H:%M:%S"
            ),
            int(st.st_mtime),
        )
    except Exception:
        return (None, None, None)


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


def _cutover_starting_capital(conn: sqlite3.Connection, epoch: str) -> float | None:
    """POST-cutover starting capital (PCT-DENOM-FIX3, 2026-07-03) — the base every
    epoch-floored window (1W/1M/ALL) divides by.

    `AUTO_CUTOVER_EPOCH` marks the START of the V2 migration, but the account stayed
    mid-drain (~$21) for ~3.5h AFTER it, until the funding deposit landed and equity
    jumped to ~$69.74. `get_equity_at(epoch)` returns the at-or-BEFORE-epoch snapshot
    = the ~$21.63 MID-MIGRATION SEED, which is NOT the account's real starting capital
    for the post-cutover run.

    Jump-detection: return the first snapshot AT-OR-AFTER the epoch whose realized-basis
    value is >= 2x the at-or-before-epoch seed (the funding deposit is a clean ~3.3x jump
    from the drain level → first match = the first funded reading, ~$69.74). Self-calibrating
    (no hardcoded ts or dollar threshold), deterministic over immutable history, and
    FAIL-SAFE: falls back to the epoch seed if no jump exists / the table is empty (never
    crashes, never null-poisons).

    NOT get_equity_at(epoch) (=$21.63 mid-migration seed). NOT MIN(ts) (=$70.91 old-wallet
    earliest snapshot — the latent BASE bug the prior fix killed; do NOT resurrect it).
    Read-only: reuses the caller's mode=ro connection, parameterized, error-handled.
    """
    seed = get_equity_at(conn, epoch)
    if seed is None:
        return None  # empty table → caller renders "—" (fail-open)
    try:
        row = conn.execute(
            "SELECT COALESCE(realized_equity, equity) FROM equity_snapshots "
            "WHERE ts >= ? AND COALESCE(realized_equity, equity) >= ? "
            "ORDER BY ts ASC LIMIT 1",
            (epoch, seed * 2.0),
        ).fetchone()
        if row is not None and row[0] is not None:
            return float(row[0])  # first funded reading after the deposit jump
    except Exception:
        pass
    return seed  # fail-safe: no funding jump found → prior (seed) behavior


def _per_ticker_enabled() -> bool:
    """Runtime import — no hardcoded drift. Matches query_auto_per_ticker_thresholds.py."""
    try:
        sys.path.insert(0, "/home/trevor/trevor")
        import ticker_thresholds as tt  # type: ignore[import-not-found]
        return bool(getattr(tt, "PER_TICKER_THRESHOLDS_ENABLED", False))
    except Exception:
        return False


def _live_account_value(
    conn: sqlite3.Connection, now_utc: datetime
) -> tuple[float | None, int | None, bool]:
    """The TRUE live account value (total $ on Hyperliquid), read from
    auto_config.LIVE_ACCOUNT_VALUE_USD (RM-EQUITY-RESTORE B1).

    DISPLAY-ONLY, read-only. The bot already fetched this equity in its ~5-min
    monitor drift-check and writes it to auto_config every cycle — this NEVER
    calls Hyperliquid and NEVER writes. Returns (value, age_seconds, stale).

    Freshness is gauged from the row's `updated_at` (UTC 'YYYY-MM-DD HH:MM:SS'):
    older than LIVE_ACCOUNT_VALUE_STALE_S (2700s ≈ 45min — sized for the ~20-min
    tailsync replica + ~5-min writer cadence) → stale=True, so the UI renders "—"
    rather than a frozen number as current. A missing / unparseable-timestamp /
    unreadable row → stale=True. There is NO secondary backstop: a stale
    equity_snapshots value would be even older (hourly), so honest "—" wins over a
    staler number presented as live.
    """
    try:
        row = conn.execute(
            "SELECT value, updated_at FROM auto_config "
            "WHERE key='LIVE_ACCOUNT_VALUE_USD'"
        ).fetchone()
        if row is None or row[0] is None:
            return (None, None, True)
        value = float(row[0])
        raw_ts = str(row[1]).strip() if row[1] is not None else ""
        try:
            updated = datetime.strptime(raw_ts, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
        except (ValueError, TypeError):
            # Value present but no parseable timestamp → can't prove freshness → "—".
            return (value, None, True)
        age = int((now_utc - updated).total_seconds())
        return (value, age, age > LIVE_ACCOUNT_VALUE_STALE_S)
    except Exception:
        return (None, None, True)


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
        # B2-RM-PROFIT: no window was computed on the fail-safe path, so there is
        # no day to name. None => the card omits the date rather than printing
        # the browser's "today" over numbers that were never measured.
        "window_et_dates": None,
        "realized_count": {"today": 0, "yesterday": 0, "week": 0, "month": 0, "all": 0},
        "realized_unknown_count": 0,
        "open_margin_usd": 0.0,
        "open_notional_usd": 0.0,  # B2-RM-PROFIT: Σ(margin × leverage)
        "unrealized_usd": 0.0,
        "open_count": 0,
        # RM-EQUITY-RESTORE B1: true live account value (auto_config
        # LIVE_ACCOUNT_VALUE_USD). Fail-safe default → stale → UI renders "—".
        "live_account_value_usd": None,
        "live_account_value_age_s": None,
        "live_account_value_stale": True,
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
        # W4a (2026-07-30): the EFFECTIVE trading mode. `live_enabled`
        # (AUTO_LIVE_ENABLED) is the CONFIGURED execution flag and gates nothing
        # on the bot; `PAPER_WINDOW_ENABLED` is the load-bearing v5 boundary gate
        # (VM auto_trader/config.py:398 — "the load-bearing boundary gate for the
        # v5 cutover"; live_executor._paper_window_on() branches on it). These are
        # DIFFERENT facts and must never be collapsed into one badge.
        #
        # `paper_window_state` is the three-state authority the Hub badge derives
        # from — a broken read and a deliberate state are different things:
        #   "on"     row present, true      -> the bot is paper-gated   -> PAPER
        #   "off"    row present, false     -> the bot executes live    -> LIVE
        #   "absent" row missing            -> UNCONFIRMABLE            -> PAPER?
        #   "error"  read threw / DB gone   -> UNKNOWN                  -> PAPER
        # 🚨 "absent" is NOT "off". The VM's DEFAULTS
        # (auto_trader/config.py:410) map an absent key to 'false' => the bot
        # would execute LIVE, so rendering a confident PAPER there would be the
        # inverse of the bug this fixes. It renders as unconfirmed instead.
        # Default here is "error": this dict is what ships on the DB-missing and
        # exception paths, and a failed read must never present as LIVE.
        "paper_window_state": "error",
        "paper_window_enabled": True,
        # W4a: age of the read-only litestream replica this payload was built
        # from (mtime of the published file, ~20 min lag by design). Surfaced so
        # an empty screen never reads as "nothing happened" when the truth is
        # "the replica has not caught up". None => the Hub renders no age claim
        # rather than a false one.
        "replica_age_seconds": None,
        "replica_mtime_utc": None,
        # B2-RM-PROFIT: absent watermark on the fail-safe path => the Hub
        # renders UNKNOWN. Never 0 (epoch 1970 would read as maximally stale,
        # which is a measurement nobody took) and never `now` (which would read
        # as perfectly fresh — the exact defect this key exists to close).
        "replica_mtime_epoch_s": None,
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
                    'EMERGENCY_KILLSWITCH', 'PAPER_WINDOW_ENABLED'
                )
                """
            ).fetchall()
            cfg = {r["key"]: r["value"] for r in cfg_rows}

            # V2 cutover epoch (B3): both HISTORICAL reads below (closed_rows +
            # total_count_row) are floored at the epoch. The epoch (auto_config
            # AUTO_CUTOVER_EPOCH) is a UTC string while closed_at is naive EASTERN
            # (two-clock rule), so this floor carries a ~4h skew band AT the
            # 2026-07-02 cutover ONLY — immaterial now (every live trade is weeks
            # post-cutover). PRESERVED exactly (Ghost's cutover law; the reference
            # query_auto_trades.py floors identically). Lexical >= is chronological.
            epoch = _cutover_epoch(conn)

            # PCT-DENOM-FIX3 (2026-07-03): the POST-cutover STARTING CAPITAL — the
            # fixed base every epoch-floored window (1W/1M/ALL) divides by. NOT the
            # at-or-before-epoch snapshot (=$21.63 mid-migration seed, the bug), NOT
            # MIN(ts) (=$70.91 old-wallet earliest, the latent bug the prior fix
            # killed) — it's the first FUNDED reading after the migration deposit
            # landed (~$69.74), found by jump-detection (>=2x the epoch seed). Append-
            # only snapshots + immutable history ⇒ the same figure every request, zero
            # stored state. None (empty table) → route renders "—" (fail-open).
            cutover_base = _cutover_starting_capital(conn, epoch)

            # REALIZED source: every closed trade (closed_at naive EASTERN +
            # pnl_usd). Bucketed in Python on ET-calendar boundaries (raw ET string
            # compare, _et_window_starts).
            #
            # 🚨 W4a (2026-07-30): the `trade_mode='live'` filter is REMOVED. It
            # was added by R2 (B1-ET-DAY-BOUNDARY) whose own comment read "Benign
            # today (0 paper rows past the cutover)" — true when written, FALSE
            # since PAPER_WINDOW_ENABLED went true on 2026-07-23. Measured on the
            # WSL replica 2026-07-30: 11 closed trades past the cutover, 7 live +
            # 4 paper, and the Hub was reporting 7. The filter was silently
            # deleting a third of the record during a multi-week paper run.
            #
            # The window is now MODE-BLIND and every consumer LABELS instead. The
            # AUTO_CUTOVER_EPOCH floor is deliberate and UNCHANGED (Ghost's law);
            # measured, it excludes 0 of the 11 — it was never the cause.
            closed_rows = conn.execute(
                "SELECT closed_at, pnl_usd, partial_pnl_realized FROM auto_trades "
                "WHERE status='closed' AND closed_at >= ?",
                (epoch,),
            ).fetchall()

            # OPEN margin = Σ posted margin of currently-open positions (BOTH
            # live + paper opens, matching the existing open-count tile).
            # 🚨 `notional_usd` IS THE POSTED MARGIN, not position notional —
            # sum it DIRECTLY, never ÷ leverage (that trap ~7×'s the figure).
            # True notional = margin × leverage; this field is deliberately the
            # margin, which is what the card's "deployed" label means.
            #
            # ─────────────────────────────────────────────────────────────────
            # B2-RM-PROFIT (2026-08-14): `position_notional` added ALONGSIDE the
            # margin — additive, the margin sum is byte-unchanged.
            #
            # 🚨 THE RISK IS CONCENTRATED IN THE NAMING, AND IT IS INVISIBLE
            # TODAY. The card rendered the margin under the word "deployed",
            # which is honest for margin — but the only open position is at
            # leverage 1.0, so margin and notional are the SAME NUMBER and no
            # reader can tell which one they are looking at. At the historic 10x
            # default the same line would have understated real exposure by 10×.
            # A test at 1.0 proves nothing; both terms now ship so the
            # distinction is legible at every leverage.
            #
            # Semantics CONFIRMED ARITHMETICALLY against live rows rather than
            # taken from the standing law. The decisive test is `pnl_pct`: on
            # 1,324 of 1,325 levered closed rows with no partials it reproduces
            # as `directional/entry * LEVERAGE` — ROE on MARGIN. The unlevered
            # form (which is what it would be if `notional_usd` held the
            # position size) matches only 9 of 1,325. Corroborated by
            # `pnl_usd / (pnl_pct% * notional_usd)` having median 0.8488 — a
            # fee-reduced fraction of 1, i.e. the ROE% applies to notional_usd.
            #
            # 🚨 DO NOT USE `original_notional_usd` HERE, AND DO NOT BELIEVE IT
            # IS ALWAYS `notional_usd * leverage`. Measured across all 1,913
            # rows: 994 are NULL, and of the rest 375 differ. Two distinct
            # reasons, both real:
            #   · PRE-CUTOVER the column held the MARGIN, not the notional —
            #     id=4 carries notional_usd=10, leverage=10, orig=10. Its
            #     meaning changed over time, so it is not a safe authority.
            #   · POST-CUTOVER (139 of 166 agree) the 27 that differ are
            #     PARTIAL EXITS: `notional_usd` is decremented as the position
            #     is scaled out while `original_notional_usd` stays frozen at
            #     ENTRY (id=101740: orig 64.49 vs current margin 38.69).
            # That second case is exactly why the product is the right term
            # here — this line answers "how much is exposed RIGHT NOW", not
            # "how much was exposed at entry". Mirrors query_leverage_regime's
            # `total_ntl_pos`, so the two surfaces cannot report different
            # exposure for the same book.
            # COALESCE(leverage, 1) — a NULL leverage means un-levered, and the
            # row must still contribute its margin rather than vanishing.
            # ─────────────────────────────────────────────────────────────────
            open_row = conn.execute(
                "SELECT COUNT(*) AS n, COALESCE(SUM(notional_usd), 0) AS notional, "
                "COALESCE(SUM(notional_usd * COALESCE(leverage, 1)), 0) AS position_notional "
                "FROM auto_trades WHERE status='open'"
            ).fetchone()

            # W4a: mode-blind, matching closed_rows above. This is the query that
            # rendered "7 total" on the capital hero while 11 trades existed.
            total_count_row = conn.execute(
                "SELECT COUNT(*) AS n FROM auto_trades "
                "WHERE status='closed' AND closed_at >= ?",
                (epoch,),
            ).fetchone()

            # W4a: how many of that window are PAPER — drives the hero's PAPER
            # label. Counted from the SAME epoch-floored window so the label can
            # never disagree with the number it sits beside.
            #
            # 🚨 B6-LEDGER (2026-08-09): the predicate was `trade_mode='paper'`.
            # That column is NOT the authority and it UNDERCOUNTED PAPER BY SEVEN
            # — measured on the WSL replica (mtime 2026-08-09 21:20:50 EDT):
            # epoch-bounded 60 -> 67 of 67 closed trades. The seven, and why each
            # was mislabelled:
            #   #101733 FARTCOIN 2026-07-23  trade_mode='live', paper_window=0
            #       — the FIRST paper fill. BOTH columns lie: `insert_trade` still
            #         dropped paper_window (default 0) and the row was stamped
            #         'live'. Only the synthetic oid 9000000000001 tells the truth.
            #   #101734 kPEPE    2026-07-25  trade_mode='live', paper_window=1
            #   #101735 kPEPE    2026-07-26  trade_mode='live', paper_window=1
            #   #101736 kPEPE    2026-07-26  trade_mode='live', paper_window=1
            #   #101737 kPEPE    2026-07-27  trade_mode='live', paper_window=1
            #   #101738 DOGE     2026-07-27  trade_mode='live', paper_window=1
            #   #101739 FARTCOIN 2026-07-27  trade_mode='live', paper_window=1
            #       — six rows written BEFORE RD-B4 (`dc0458d`) fixed the
            #         hardcoded stamp, so a paper fill was recorded 'live'.
            #         paper_window was already persisting truthfully by then.
            #
            # 🚨 `paper_window` ALONE IS THE WRONG FIX: it recovers six of the
            # seven and leaves #101733 wrong — a second wrong answer, harder to
            # see than the first. The rule is delegated to lib.paper_mode, which
            # mirrors auto_trader/watchdog.py::_is_paper_position (VM) and
            # declares the synthetic-oid floor exactly once.
            #
            # Over-count is zero: all seven carry an oid >= the 9e12 floor, and
            # no row this predicate adds is a real order. The epoch floor is
            # UNCHANGED (Ghost's cutover law) and is what keeps this honest — see
            # lib/paper_mode.py on why a WHOLE-TABLE count must not be built on
            # this predicate.
            paper_count_row = conn.execute(
                "SELECT COUNT(*) AS n FROM auto_trades "
                f"WHERE status='closed' AND closed_at >= ? AND {is_paper_sql()}",
                (epoch,),
            ).fetchone()

            # WA-P1 (PCT-D1/D2) + PCT-DENOM-FIX3 (2026-07-03): start-of-window
            # realized-basis equity per window, read inside the SAME mode=ro
            # connection. Each window's % divides its realized P&L by the account
            # equity at that window's START (not the current live equity), so it's
            # a true return over the window's span. Every window start is FLOORED
            # at the cutover epoch (max(start, epoch)) so the denominator matches
            # the numerator — which is already epoch-floored (closed_rows WHERE
            # closed_at >= epoch).
            #   · A window whose floored start == the epoch (1W/1M/ALL, an old
            #     CUSTOM span) uses the POST-cutover STARTING CAPITAL (cutover_base,
            #     ~$69.74 — the first funded reading) — NOT get_equity_at(epoch)
            #     (=$21.63 mid-migration seed, the bug PCT-DENOM-FIX3 fixes).
            #   · A window whose start is POST-epoch (today/yesterday) keeps its OWN
            #     real start-of-day equity via get_equity_at — untouched.
            # None for any window whose base is missing → UI renders "—".
            now_utc = datetime.now(UTC)

            # W4a: the EFFECTIVE trading mode + the replica's publish age. Both
            # derive here, inside the successful-read branch, so the fail-safe
            # `out` defaults ("error"/None) survive untouched on any throw.
            _pw_state, _pw_is_paper = _paper_window_state(cfg)
            _replica_age_s, _replica_mtime, _replica_mtime_epoch = _replica_age(now_utc)

            # ─────────────────────────────────────────────────────────────────
            # B2-RM-PROFIT (2026-08-14): the ET CALENDAR DAY each window covers,
            # so a card can name the day it is summarising.
            #
            # 🚨 SLICED FROM `_et_window_starts`' OWN OUTPUT, never recomputed.
            # The whole point is that a held payload shows the day it actually
            # measured, not the day it is being looked at — so the label must be
            # the query's own boundary, and deriving it a second way (here or in
            # the browser from `now`) would let the two disagree by exactly the
            # amount that matters. `_et_window_starts` is UNCHANGED; this reads
            # the naive-ET 'YYYY-MM-DD 00:00:00' strings it already produced and
            # takes the date half. No new clock, no conversion, no new boundary.
            #
            # `end` is the last ET day the windows include (all windows run to
            # the end of the current ET day) — carried so a range can be printed
            # without the browser re-deriving "today" from its own clock.
            # ─────────────────────────────────────────────────────────────────
            _et_starts = _et_window_starts(now_utc)
            _window_et_dates = {
                "today": _et_starts["today"][:10],
                "yesterday": _et_starts["yesterday"][:10],
                "week": _et_starts["week"][:10],
                "month": _et_starts["month"][:10],
                # ALL is floored at the cutover epoch, which is the real left
                # edge of every "all-time" figure on this card. `epoch` is UTC
                # 'YYYY-MM-DD HH:MM:SS'; its DATE is what a reader needs.
                "all": epoch[:10] if isinstance(epoch, str) and len(epoch) >= 10 else None,
                "end": _et_starts["today"][:10],
            }

            # RM-EQUITY-RESTORE B1: true live account value + freshness, read from
            # the SAME mode=ro connection (display-only, no HL call, never writes).
            live_av, live_av_age, live_av_stale = _live_account_value(conn, now_utc)

            # 🚨 UTC window starts for the equity BASE — get_equity_at reads
            # equity_snapshots.ts (REAL UTC), NOT closed_at. This is the SEPARATE
            # clock from the ET boundaries compute_windows uses for closed_at (two-
            # clock rule). Feeding ET boundaries here would query snapshots 4h early.
            starts = _utc_window_starts(now_utc)
            base_starts = {
                "today": max(starts["today"], epoch),
                "yesterday": max(starts["yesterday"], epoch),
                "week": max(starts["week"], epoch),
                "month": max(starts["month"], epoch),
                "all": epoch,
            }
            realized_base = {
                k: (cutover_base if ts == epoch else get_equity_at(conn, ts))
                for k, ts in base_starts.items()
            }

            # WA-P2 (2026-06-12): optional custom date-range window. The two picked
            # dates arrive as argv (start, end 'YYYY-MM-DD'); _parse_custom_args maps
            # them to BOTH clocks (two-clock rule): `custom_et` (naive-ET) buckets the
            # closed_at rows in compute_custom; `custom_utc` (real UTC) reads the
            # start-of-window base via the SAME get_equity_at (A-P1's denominator)
            # inside this SAME mode=ro connection — zero new denominator math.
            _custom = _parse_custom_args(sys.argv[1:])
            custom_et = _custom[0] if _custom is not None else None
            custom_utc = _custom[1] if _custom is not None else None
            # PCT-DENOM-FIX3: floor the custom span's start at the cutover epoch too
            # — a range reaching before the cutover clamps to the epoch and uses the
            # POST-cutover starting capital (cutover_base, ~$69.74); a fully-post-epoch
            # range keeps its own start-of-window equity. Matches the epoch-floored
            # numerator. UTC start (custom_utc) vs the UTC epoch — both UTC, coherent.
            custom_base = None
            if custom_utc is not None:
                cstart = max(custom_utc[0], epoch)
                custom_base = (
                    cutover_base if cstart == epoch else get_equity_at(conn, cstart)
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
        if custom_et is not None:
            cwin = compute_custom(
                (
                    (r["closed_at"], r["pnl_usd"], r["partial_pnl_realized"])
                    for r in closed_rows
                ),
                custom_et[0],  # naive-ET bounds vs naive-ET closed_at
                custom_et[1],
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
            "cutover_base_usd": cutover_base,  # PCT-DENOM-FIX3: post-cutover starting capital (~$69.74)
            # B2-RM-PROFIT: the ET calendar day(s) each window covers, sliced
            # from the query's OWN boundaries so a held payload names the day it
            # measured rather than the day it is being read on.
            "window_et_dates": _window_et_dates,
            "realized_count": win["realized_count"],
            "realized_unknown_count": win["realized_unknown_count"],
            "open_margin_usd": round(float(open_row["notional"] or 0.0), 4),
            # B2-RM-PROFIT: Σ(margin × leverage) — the POSITION NOTIONAL, i.e.
            # the size actually exposed to the market. Additive and display-only;
            # `open_margin_usd` above is untouched. Equal to the margin only
            # while every open position sits at leverage 1.0.
            "open_notional_usd": round(
                float(open_row["position_notional"] or 0.0), 4
            ),
            "unrealized_usd": unrealized,
            "open_count": open_count,
            # RM-EQUITY-RESTORE B1: true live account value + freshness (real $ or,
            # when stale/missing, stale=True → the UI renders "—", never a frozen
            # number). Additive; flows through the route's `...value` spread.
            "live_account_value_usd": live_av,
            "live_account_value_age_s": live_av_age,
            "live_account_value_stale": live_av_stale,
            # --- legacy / shared back-compat ---
            "capital_usd": 0.0,             # vestigial; no starting-capital concept
            "live_capital_usd": 0.0,        # vestigial; collapses Hub "of $X cap" line
            "equity": equity,              # alias of equity_usd
            "pnl_today_usd": realized["today"],          # now ET-calendar (was rolling-24h)
            # legacy/dead field (no consumer): keep numeric — None base → 0.0
            "pnl_today_pct": realized_pct["today"] if realized_pct["today"] is not None else 0.0,
            "trades_today": win["realized_count"]["today"],
            "trades_total": int(total_count_row["n"] or 0),
            # W4a: how many of `trades_total` are paper — the hero's PAPER label.
            "trades_paper_count": int(paper_count_row["n"] or 0),
            "open_positions_count": open_count,
            "auto_enabled":  str(cfg.get("AUTO_TRADER_ENABLED", "false")).lower() == "true",
            # CONFIGURED execution flag. Deliberately kept and deliberately named
            # apart from the effective mode below — it gates nothing on the bot,
            # and conflating the two is what rendered a LIVE badge over 1,524
            # [PAPER-BLOCK] lines. Do not source a mode badge from this.
            "live_enabled":  str(cfg.get("AUTO_LIVE_ENABLED", "false")).lower() == "true",
            # W4a: the EFFECTIVE mode — what the bot actually gates on.
            "paper_window_state": _pw_state,
            "paper_window_enabled": _pw_is_paper,
            "replica_age_seconds": _replica_age_s,
            "replica_mtime_utc": _replica_mtime,
            # B2-RM-PROFIT: the ABSOLUTE watermark the freshness stamp is
            # derived from. See _replica_age's docstring for why the duration
            # above cannot carry that job. Additive; None => Hub renders UNKNOWN.
            "replica_mtime_epoch_s": _replica_mtime_epoch,
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
