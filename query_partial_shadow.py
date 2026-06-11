#!/usr/bin/env python3
"""
query_partial_shadow.py — Read-only aggregations over partial_trigger_shadow
for /api/shadow/partials GET (B4, 2026-05-27).

Surfaces the data the Layer 5 partial-exit shadow eval (B4 wire-site fix to
monitor.py:1363-1591) writes once per cycle for every live or paper trade
that's at-or-near a partial trigger. The bot writes; this script reads and
shapes it for the Hub card.

Output JSON shape:
  {
    "summary": {
      "rows_24h": int,
      "rows_7d": int,
      "would_fire_24h": int,
      "would_fire_7d": int,
      "near_miss_24h": int,
      "near_miss_7d": int,
      "would_fire_trades_24h": int,         # DISTINCT auto_trade_id, would_fire
      "would_fire_trades_7d": int,          # — the honest de-duped headline
      "modes": { "live_disabled": N, "live_enabled": N, "paper": N, ... },
      "live_partials_enabled": bool,        # current auto_config flag value
    },
    # NOTE (SH-HUB 2026-06-11): would_have_profit_usd_7d was REMOVED — it summed
    # one profit_usd per per-cycle would_fire row (~40-70 rows/trade), grossly
    # inflating a green "+$X profit" that was never realizable. Counts only now.
    "by_level": [ {                         # one per partial_level_r
      "partial_level_r": float,
      "partial_pct": float,
      "would_fire_7d": int,
      "near_miss_7d": int,
      "blocked_dust_7d": int,
      "blocked_fee_7d": int,
    }, ... ],
    "by_ticker": [ {                        # one per ticker (7d)
      "ticker": str,
      "would_fire": int,                    # eval-rows (per-cycle)
      "would_fire_trades": int,             # DISTINCT trades — the honest count
      "near_miss": int,
    }, ... ],
    "recent": [ {                           # last 10 rows, newest first
      "created_at": str,
      "ticker": str,
      "partial_level_r": float,
      "current_r": float,
      "would_fire": bool,
      "skip_reason": str | null,
      "near_miss": bool,
      "partials_mode": str,
      "close_amount_usd": float | null,
      "profit_usd": float | null,
    }, ... ]
  }

A bare top-level "error" key with status 200 means the table is missing or
unreadable (the route handler degrades to an empty card).
"""
import json
import sqlite3
from typing import Optional

DB_PATH = "/home/trevor/trevor/trevor.db"
DB_RO_URI = f"file:{DB_PATH}?mode=ro"

WINDOW_24H = "datetime('now', '-1 day')"
WINDOW_7D = "datetime('now', '-7 days')"


def _conn_ro() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_RO_URI, uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def _bool_from_config(conn: sqlite3.Connection, key: str, default: bool = False) -> bool:
    try:
        row = conn.execute(
            "SELECT value FROM auto_config WHERE key=?", (key,),
        ).fetchone()
    except sqlite3.OperationalError:
        return default
    if not row:
        return default
    return (row["value"] or "").strip().lower() == "true"


def _safe_notes(notes_json: Optional[str]) -> dict:
    if not notes_json:
        return {}
    try:
        parsed = json.loads(notes_json)
        return parsed if isinstance(parsed, dict) else {}
    except (ValueError, TypeError):
        return {}


def _count(conn: sqlite3.Connection, where: str, params: tuple = ()) -> int:
    row = conn.execute(
        f"SELECT COUNT(*) AS n FROM partial_trigger_shadow WHERE {where}",
        params,
    ).fetchone()
    return int(row["n"]) if row else 0


def _count_trades(conn: sqlite3.Connection, where: str, params: tuple = ()) -> int:
    # DISTINCT auto_trade_id — the bot writes one row PER MONITOR CYCLE per trade,
    # so a raw row COUNT inflates ~40-70x. Distinct-trade is the honest count.
    row = conn.execute(
        f"SELECT COUNT(DISTINCT auto_trade_id) AS n FROM partial_trigger_shadow WHERE {where}",
        params,
    ).fetchone()
    return int(row["n"]) if row and row["n"] is not None else 0


def _summary(conn: sqlite3.Connection) -> dict:
    rows_24h = _count(conn, f"created_at >= {WINDOW_24H}")
    rows_7d = _count(conn, f"created_at >= {WINDOW_7D}")
    would_fire_24h = _count(
        conn, f"created_at >= {WINDOW_24H} AND would_fire = 1"
    )
    would_fire_7d = _count(
        conn, f"created_at >= {WINDOW_7D} AND would_fire = 1"
    )
    # Honest headline: distinct TRADES that would have partialed (not eval-rows).
    would_fire_trades_24h = _count_trades(
        conn, f"created_at >= {WINDOW_24H} AND would_fire = 1"
    )
    would_fire_trades_7d = _count_trades(
        conn, f"created_at >= {WINDOW_7D} AND would_fire = 1"
    )

    # Near-miss + mode breakdown require notes_json parsing — SQLite has no
    # native JSON funcs across all builds; iterate the rows.
    #
    # NOTE (SH-HUB, 2026-06-11): the old `would_have_profit_usd_7d` figure was
    # REMOVED here. It summed notes_json.profit_usd across EVERY per-cycle
    # would_fire row, re-counting each trade's slice ~40-70x → a hugely inflated
    # green "+$X profit" that was not realizable money. No de-duped dollar
    # replaced it (the de-dup key is not clean and any $ reads as banked P&L on
    # a live-but-counterfactual feature). The honest signal is the distinct-trade
    # + near-miss + eval COUNTS above; profit is intentionally not surfaced.
    rows = conn.execute(
        "SELECT created_at, would_fire, notes_json "
        f"FROM partial_trigger_shadow WHERE created_at >= {WINDOW_7D}"
    ).fetchall()
    near_miss_24h = 0
    near_miss_7d = 0
    modes: dict[str, int] = {}
    # We need a separate fetch for 24h near-miss boundary — use a SQL filter
    # on created_at as well. Keep a cheap split with two passes here.
    cutoff_24h_row = conn.execute(
        f"SELECT {WINDOW_24H} AS cutoff"
    ).fetchone()
    cutoff_24h = cutoff_24h_row["cutoff"] if cutoff_24h_row else None
    for r in rows:
        notes = _safe_notes(r["notes_json"])
        mode = notes.get("partials_mode") or "unknown"
        modes[mode] = modes.get(mode, 0) + 1
        if notes.get("near_miss"):
            near_miss_7d += 1
            if cutoff_24h and r["created_at"] and r["created_at"] >= cutoff_24h:
                near_miss_24h += 1

    return {
        "rows_24h": rows_24h,
        "rows_7d": rows_7d,
        "would_fire_24h": would_fire_24h,
        "would_fire_7d": would_fire_7d,
        "would_fire_trades_24h": would_fire_trades_24h,
        "would_fire_trades_7d": would_fire_trades_7d,
        "near_miss_24h": near_miss_24h,
        "near_miss_7d": near_miss_7d,
        "modes": modes,
        "live_partials_enabled": _bool_from_config(conn, "LIVE_PARTIALS_ENABLED"),
    }


def _by_level(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        f"""SELECT partial_level_r, partial_pct, would_fire, skip_reason, notes_json
            FROM partial_trigger_shadow
            WHERE created_at >= {WINDOW_7D}"""
    ).fetchall()
    bucket: dict[float, dict] = {}
    for r in rows:
        level = r["partial_level_r"]
        if level is None:
            continue
        b = bucket.setdefault(
            float(level),
            {
                "partial_level_r": float(level),
                "partial_pct": float(r["partial_pct"]) if r["partial_pct"] is not None else None,
                "would_fire_7d": 0,
                "near_miss_7d": 0,
                "blocked_dust_7d": 0,
                "blocked_fee_7d": 0,
            },
        )
        if int(r["would_fire"] or 0) == 1:
            b["would_fire_7d"] += 1
        notes = _safe_notes(r["notes_json"])
        if notes.get("near_miss"):
            b["near_miss_7d"] += 1
        if r["skip_reason"] == "dust_skipped":
            b["blocked_dust_7d"] += 1
        elif r["skip_reason"] == "fee_guard_blocked":
            b["blocked_fee_7d"] += 1
    return sorted(bucket.values(), key=lambda x: x["partial_level_r"])


def _by_ticker(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        f"""SELECT ticker, auto_trade_id, would_fire, notes_json
            FROM partial_trigger_shadow
            WHERE created_at >= {WINDOW_7D}"""
    ).fetchall()
    bucket: dict[str, dict] = {}
    # Track distinct would-fire trades per ticker (not eval-rows) — same
    # de-dup rationale as the summary headline (SH-HUB). No dollar surfaced.
    fire_trades: dict[str, set] = {}
    for r in rows:
        t = (r["ticker"] or "").strip() or "UNKNOWN"
        b = bucket.setdefault(
            t,
            {"ticker": t, "would_fire": 0, "would_fire_trades": 0, "near_miss": 0},
        )
        if int(r["would_fire"] or 0) == 1:
            b["would_fire"] += 1
            fire_trades.setdefault(t, set()).add(r["auto_trade_id"])
        else:
            notes = _safe_notes(r["notes_json"])
            if notes.get("near_miss"):
                b["near_miss"] += 1
    for t, b in bucket.items():
        b["would_fire_trades"] = len(fire_trades.get(t, set()))
    return sorted(bucket.values(), key=lambda x: x["would_fire_trades"], reverse=True)


def _recent(conn: sqlite3.Connection, limit: int = 10) -> list[dict]:
    rows = conn.execute(
        """SELECT created_at, ticker, partial_level_r, partial_pct,
                  current_r, peak_r, would_fire, skip_reason, notes_json
            FROM partial_trigger_shadow
            ORDER BY id DESC LIMIT ?""",
        (int(limit),),
    ).fetchall()
    out = []
    for r in rows:
        notes = _safe_notes(r["notes_json"])
        out.append(
            {
                "created_at": r["created_at"],
                "ticker": r["ticker"],
                "partial_level_r": r["partial_level_r"],
                "partial_pct": r["partial_pct"],
                "current_r": r["current_r"],
                "peak_r": r["peak_r"],
                "would_fire": bool(int(r["would_fire"] or 0)),
                "skip_reason": r["skip_reason"],
                "near_miss": bool(notes.get("near_miss")),
                "partials_mode": notes.get("partials_mode") or "unknown",
                "close_amount_usd": notes.get("close_amount_usd"),
                "profit_usd": notes.get("profit_usd"),
            }
        )
    return out


def main() -> None:
    payload: dict = {
        "summary": {
            "rows_24h": 0, "rows_7d": 0,
            "would_fire_24h": 0, "would_fire_7d": 0,
            "would_fire_trades_24h": 0, "would_fire_trades_7d": 0,
            "near_miss_24h": 0, "near_miss_7d": 0,
            "modes": {},
            "live_partials_enabled": False,
        },
        "by_level": [],
        "by_ticker": [],
        "recent": [],
    }
    try:
        with _conn_ro() as conn:
            payload["summary"] = _summary(conn)
            payload["by_level"] = _by_level(conn)
            payload["by_ticker"] = _by_ticker(conn)
            payload["recent"] = _recent(conn)
    except sqlite3.OperationalError as e:
        payload["error"] = f"db: {e}"
    except Exception as e:
        payload["error"] = str(e)
    print(json.dumps(payload, default=str))


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
