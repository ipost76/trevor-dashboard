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
      "modes": { "live_disabled": N, "live_enabled": N, "paper": N, ... },
      "would_have_profit_usd_7d": float,    # sum of notes_json.profit_usd
                                            # for would_fire rows in 7d
      "live_partials_enabled": bool,        # current auto_config flag value
    },
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
      "would_fire": int,
      "near_miss": int,
      "would_have_profit_usd": float,
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


def _summary(conn: sqlite3.Connection) -> dict:
    rows_24h = _count(conn, f"created_at >= {WINDOW_24H}")
    rows_7d = _count(conn, f"created_at >= {WINDOW_7D}")
    would_fire_24h = _count(
        conn, f"created_at >= {WINDOW_24H} AND would_fire = 1"
    )
    would_fire_7d = _count(
        conn, f"created_at >= {WINDOW_7D} AND would_fire = 1"
    )

    # Near-miss + mode breakdown + profit sum require notes_json parsing —
    # SQLite has no native JSON funcs across all builds; iterate the rows.
    rows = conn.execute(
        "SELECT created_at, would_fire, notes_json "
        f"FROM partial_trigger_shadow WHERE created_at >= {WINDOW_7D}"
    ).fetchall()
    near_miss_24h = 0
    near_miss_7d = 0
    modes: dict[str, int] = {}
    would_have_profit_7d = 0.0
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
        if int(r["would_fire"] or 0) == 1:
            profit = notes.get("profit_usd")
            if isinstance(profit, (int, float)):
                would_have_profit_7d += float(profit)

    return {
        "rows_24h": rows_24h,
        "rows_7d": rows_7d,
        "would_fire_24h": would_fire_24h,
        "would_fire_7d": would_fire_7d,
        "near_miss_24h": near_miss_24h,
        "near_miss_7d": near_miss_7d,
        "modes": modes,
        "would_have_profit_usd_7d": round(would_have_profit_7d, 4),
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
        f"""SELECT ticker, would_fire, notes_json
            FROM partial_trigger_shadow
            WHERE created_at >= {WINDOW_7D}"""
    ).fetchall()
    bucket: dict[str, dict] = {}
    for r in rows:
        t = (r["ticker"] or "").strip() or "UNKNOWN"
        b = bucket.setdefault(
            t,
            {"ticker": t, "would_fire": 0, "near_miss": 0, "would_have_profit_usd": 0.0},
        )
        if int(r["would_fire"] or 0) == 1:
            b["would_fire"] += 1
            notes = _safe_notes(r["notes_json"])
            profit = notes.get("profit_usd")
            if isinstance(profit, (int, float)):
                b["would_have_profit_usd"] += float(profit)
        else:
            notes = _safe_notes(r["notes_json"])
            if notes.get("near_miss"):
                b["near_miss"] += 1
    for b in bucket.values():
        b["would_have_profit_usd"] = round(b["would_have_profit_usd"], 4)
    return sorted(bucket.values(), key=lambda x: x["would_fire"], reverse=True)


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
            "near_miss_24h": 0, "near_miss_7d": 0,
            "modes": {}, "would_have_profit_usd_7d": 0.0,
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
    main()
