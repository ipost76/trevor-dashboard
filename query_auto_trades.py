#!/usr/bin/env python3
"""
Consolidated AUTO trades view for /api/auto/trades (D3, 2026-04-30).

Args:
  argv[1] = type:  'open' | 'closed' (default 'closed')
  argv[2] = limit: int 1..2000 (default 10)   # B2 (2026-07-15): ceiling 200->2000
  argv[3] = start: 'YYYY-MM-DD' inclusive ET date  (closed path only, optional)
  argv[4] = end:   'YYYY-MM-DD' inclusive ET date  (closed path only, optional)

JSON output for type='open':
  {
    "type": "open",
    "count": <N>,
    "positions": [
      { id, ticker, direction, entry_price, stop_price, target_price,
        leverage, confidence, notional_usd, opened_at, exit_signals_log,
        peak_pnl_pct, trade_mode }
    ]
  }

JSON output for type='closed':
  {
    "type": "closed",
    "count": <N>,
    "trades": [
      { id, ticker, direction, pnl_pct, pnl_usd, hold_duration_minutes,
        opened_at, closed_at, exit_reason, trade_mode, exit_layer }
    ]
  }

🚨 `exit_layer` (W4a, additive) is the Smart-Exit layer that fired, stored as
an INTEGER with FRACTIONAL layers ×10: layer 6.5 is stored `65`, layer 6.2 is
`62`. Measured all-time on the WSL replica 2026-07-30: 0(129) 1(46) 4(36)
6(747) 7(20) 62(12) 65(99) — and layers 3 (breakeven) and 45 (=4.5, ratchet)
have NEVER fired, so their first appearance is a first-ever event. Render it,
do not arithmetic on it, and never divide by 10 without checking for a real
sub-10 layer first.

Notes:
- READ-ONLY (`file:...?mode=ro`).
- 🚨 W4a (2026-07-30): the `trade_mode='live'` filter is REMOVED from BOTH
  queries. The D3 spec it implemented ("paper trades are not surfaced through
  the new AUTO endpoints") predates the v5 paper window and is superseded:
  while `PAPER_WINDOW_ENABLED` is true EVERY new trade is written
  `trade_mode='paper'`, so that filter made the entire live run invisible —
  the open-position card could never render a position at all, and the RECENT
  list showed 7 of 11 closed trades. Both queries are now MODE-BLIND and
  return `trade_mode` per row so the surface LABELS instead of hiding.
- `confidence` and stop/target prices are preserved on open positions so
  D1's ActivePositionCard fmtPrice + future PositionCards keep their data.

B2 (2026-07-15): the closed path gains an OPTIONAL inclusive ET date range
(argv[3]=start, argv[4]=end 'YYYY-MM-DD'). closed_at is EASTERN local wall-clock
(NOT UTC — see fetch_closed), so the bounds are plain ET date strings compared
directly against the stored ET strings (no timezone conversion). start/end are
INCLUSIVE picked dates; the exclusive upper bound (+1 day) is applied here — the
SAME contract as capital-hero.tsx -> query_auto_state.py (start/end inclusive).
Absent / partial / malformed / reversed -> no range -> the cutover-floored
default (fail-closed, backward-compatible; a bare 2-arg call is byte-identical to
before). The AUTO_CUTOVER_EPOCH floor stays in EVERY path incl. the range (Ghost's
law — everything is based off the cutover; a range reaching before it is clamped).
"""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

DB = "/home/trevor/trevor/trevor.db"


def _connect_ro() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10)


def _replica_age_seconds() -> int | None:
    """W4a: age of the published read-only replica, from the mtime of the file
    `DB` resolves to. Mirrors query_auto_state._replica_age (same idiom as
    drift-state/route.ts) so the two surfaces cannot report different ages for
    the same file. Returns None on any failure — the Hub then renders no
    freshness claim at all, rather than a fabricated one.
    """
    try:
        import os

        st = os.stat(os.path.realpath(DB))
        return max(
            0,
            int(datetime.now(timezone.utc).timestamp() - st.st_mtime),
        )
    except Exception:
        return None


def _cutover_epoch(conn: sqlite3.Connection) -> str:
    """V2 cutover epoch (B3): UTC 'YYYY-MM-DD HH:MM:SS' floor for the closed
    (historical) list. Reads the SAME `auto_config` key B2 set
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
        return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _range_bounds(start: str | None, end: str | None) -> tuple[str, str] | None:
    """Map an OPTIONAL inclusive ET calendar range (start, end 'YYYY-MM-DD') to a
    half-open [lo, hi) span of ET-local 'YYYY-MM-DD HH:MM:SS' strings (B2).

    closed_at is stored EASTERN local wall-clock (see fetch_closed), so the bounds
    are plain ET date strings compared directly against the stored ET strings — NO
    timezone conversion. start/end are INCLUSIVE picked dates (the capital-hero ->
    query_auto_state contract); the exclusive upper bound is `end + 1 day` compared
    with '<', so the last trade of `end` at 23:59:59 IS included and the next day's
    00:00:00 is NOT (half-open, no 23:59:59 fencepost). Pure calendar-date
    arithmetic (date + timedelta) — no tz, no DST.

    Returns (lo, hi) ONLY when BOTH dates are present AND valid AND end >= start;
    otherwise None -> the caller applies no range (the cutover-floored default).
    Fail-closed: malformed / partial / reversed input -> None (never injects, never
    crashes, never returns the wrong window).
    """
    if not start or not end:
        return None
    try:
        sd = datetime.strptime(start, "%Y-%m-%d").date()
        ed = datetime.strptime(end, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None
    if ed < sd:
        return None
    lo = f"{sd.isoformat()} 00:00:00"
    hi = f"{(ed + timedelta(days=1)).isoformat()} 00:00:00"
    return (lo, hi)


def _rows_to_dicts(cursor) -> list[dict]:
    cols = [c[0] for c in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def fetch_open(limit: int) -> dict:
    with _connect_ro() as conn:
        cur = conn.execute(
            f"""
            SELECT id, ticker, direction, entry_price, stop_price, target_price,
                   leverage, confidence, notional_usd, opened_at,
                   exit_signals_log, peak_pnl_pct, trade_mode
            FROM auto_trades
            WHERE status='open'
            ORDER BY opened_at DESC
            LIMIT {limit}
            """
        )
        rows = _rows_to_dicts(cur)
    return {
        "type": "open",
        "count": len(rows),
        "positions": rows,
        "replica_age_seconds": _replica_age_seconds(),
    }


def fetch_closed(
    limit: int, start: str | None = None, end: str | None = None
) -> dict:
    with _connect_ro() as conn:
        # V2 cutover epoch (B3): the ALWAYS-applied historical floor. Ghost's law
        # (2026-07-15): everything is based off the cutover — the floor stays in
        # EVERY path incl. the B2 range, so a range reaching before the cutover is
        # clamped to it (never returns pre-cutover rows; no escape hatch).
        epoch = _cutover_epoch(conn)

        # B2 (2026-07-15): closed_at is EASTERN local wall-clock, naive
        # 'YYYY-MM-DD HH:MM:SS' (Python datetime.now() on the America/New_York VM —
        # NOT UTC; the old "closed_at is a UTC string" comment here was stale,
        # inherited from auto_trader/models.py:25, which chop_brake.py:59 flags as
        # stale). PROOF: created_at (SQLite CURRENT_TIMESTAMP, real UTC) ==
        # opened_at + exactly 4h on every row, and UTC = EDT + 4h, so
        # opened_at/closed_at are EDT. Lexical >= / < on the fixed-width string is
        # therefore chronological ET comparison — no timezone conversion.
        # W4a: mode-blind (see the module docstring). The cutover floor stays.
        where = "status='closed' AND closed_at >= ?"
        params: list = [epoch]

        # B2: OPTIONAL inclusive ET date range -> half-open [lo, hi) ET-string
        # bounds, PARAMETERIZED (never string-interpolated). A malformed / partial /
        # reversed range yields None -> no range clause -> the cutover-floored
        # default (fail-closed). The cutover floor above still bounds the result,
        # so a range straddling the cutover returns only post-cutover rows.
        bounds = _range_bounds(start, end)
        if bounds is not None:
            where += " AND closed_at >= ? AND closed_at < ?"
            params.extend(bounds)

        # `where` is composed of STATIC fragments only (no user value ever enters
        # the SQL text); the date values are bound via `params`. `limit` is
        # int-sanitized in main() (max(1, min(2000, ...))), matching the existing
        # LIMIT-interpolation contract.
        # B1-COLLAPSE-FILTERS (2026-07-16): opened_at added (additive) so the
        # RECENT row can render the held window (opened_at -> closed_at). Same
        # naive-EASTERN clock as closed_at (created_at == opened_at + 4h proven),
        # rendered client-side via the raw HH:MM slice — never parsed as UTC.
        cur = conn.execute(
            f"""
            SELECT id, ticker, direction, pnl_pct, pnl_usd,
                   hold_duration_minutes, opened_at, closed_at, exit_reason,
                   trade_mode, exit_layer
            FROM auto_trades
            WHERE {where}
            GROUP BY id
            ORDER BY closed_at DESC
            LIMIT {limit}
            """,
            params,
        )
        # B6-RECENT-GAPS dedup guard: GROUP BY the `id` primary key so one
        # logical trade renders as exactly one RECENT row. `auto_trades` has no
        # `trade_id` column; `id` is the PK (one row per trade, partial fills are
        # the `partial_pnl_realized` column on that row, NOT extra rows), so this
        # is a defensive no-op today — proven row-identical to the ungrouped set
        # at limit 50/200/full (1097) — that can never over-collapse or hide a
        # real trade. Deliberately NOT keyed on hl_order_id/hl_exit_order_id:
        # those carry NULLs (would collapse) and can be shared by genuinely
        # distinct trades (would merge & hide one), violating "never drop a real
        # closed trade".
        rows = _rows_to_dicts(cur)
    return {
        "type": "closed",
        "count": len(rows),
        "trades": rows,
        "replica_age_seconds": _replica_age_seconds(),
    }


def main() -> int:
    typ = (sys.argv[1] if len(sys.argv) >= 2 else "closed").lower()
    try:
        limit = int(sys.argv[2]) if len(sys.argv) >= 3 else 10
    except ValueError:
        limit = 10
    # B2 (2026-07-15): ceiling 200 -> 2000 so a full ET date range (1W ~202, MAX
    # ~481 post-cutover) is returned without silent truncation. The cutover floor
    # naturally bounds the post-cutover set; the RECENT tab's capped indicator is
    # honest against this ceiling. Shared with the open path (open callers pass
    # <=50, so the raised ceiling never bites there).
    limit = max(1, min(2000, limit))
    # B2: optional inclusive ET date range for the closed path (argv[3]=start,
    # argv[4]=end 'YYYY-MM-DD'). Absent -> None -> no range (default view).
    start = sys.argv[3] if len(sys.argv) >= 4 else None
    end = sys.argv[4] if len(sys.argv) >= 5 else None

    if typ not in ("open", "closed"):
        sys.stdout.write(json.dumps({
            "type": typ, "count": 0,
            "error": f"invalid type: {typ}",
        }))
        return 1

    if not Path(DB).exists():
        sys.stdout.write(json.dumps({
            "type": typ, "count": 0,
            "positions" if typ == "open" else "trades": [],
            "error": f"DB not found: {DB}",
        }))
        return 1

    try:
        out = fetch_open(limit) if typ == "open" else fetch_closed(limit, start, end)
        sys.stdout.write(json.dumps(out, default=str))
        return 0
    except Exception as exc:
        sys.stdout.write(json.dumps({
            "type": typ, "count": 0,
            "positions" if typ == "open" else "trades": [],
            "error": f"{type(exc).__name__}: {exc}",
        }))
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
