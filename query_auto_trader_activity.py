#!/usr/bin/env python3
"""
Query helper for AutoTrader real-time activity feed.

Combines events from:
  - auto_trades (position opened + closed)
  - active_signal_cards (signal accepted + rejected)

Returns JSON {"events": [...], "queried_at": int}, each event:
  id (str), timestamp (ISO), type, ticker, detail, trade_mode (live|paper|null)

Event types:
  opened   — 🟢 auto_trades.status='open' just inserted
  closed   — 💰 (green) or 🔴 (red) auto_trades.closed_at populated
  accepted — ✅ active_signal_cards row freshly posted
  rejected — ⏸️ active_signal_cards.removed_reason populated

Args (all optional, positional):
  argv[1] = limit (1-200, default 50)
  argv[2] = since_iso (ISO timestamp, only events newer than this)
  argv[3] = filter ('all'|'live'|'trades'|'rejections', default 'all')

READ-ONLY (mode=ro URI). Uses datetime() wrappers on both sides of
timestamp comparisons to avoid the 2026-04-24 Observatory T-vs-space
string-comparison trap.
"""
from __future__ import annotations

import json
import sqlite3
import sys
import time

DB_PATH = "/home/trevor/trevor/trevor.db"
ALLOWED_FILTERS = {"all", "live", "trades", "rejections"}


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=5.0)
    c.row_factory = sqlite3.Row
    return c


def _fmt_signed_pct(v: float) -> str:
    return f"+{v:.2f}" if v >= 0 else f"{v:.2f}"


def _fmt_signed_usd(v: float) -> str:
    return f"+${v:.2f}" if v >= 0 else f"-${abs(v):.2f}"


def _fmt_price(v: float) -> str:
    if v >= 1000:
        return f"${v:,.0f}"
    if v >= 100:
        return f"${v:,.2f}"
    if v >= 1:
        return f"${v:.3f}".rstrip("0").rstrip(".")
    return f"${v:.4g}"


def query_activity(
    limit: int = 50,
    since_iso: str | None = None,
    filt: str = "all",
) -> list[dict]:
    events: list[dict] = []
    has_since = bool(since_iso and (("T" in since_iso) or (" " in since_iso)))

    conn = _conn()
    try:
        # 1. Position opens
        if filt in ("all", "live", "trades"):
            base = (
                "SELECT id, opened_at, ticker, direction, confidence, "
                "leverage, trade_mode, entry_price FROM auto_trades "
                "WHERE opened_at IS NOT NULL"
            )
            if has_since:
                base += " AND datetime(opened_at) > datetime(?)"
                params: tuple = (since_iso, limit)
            else:
                params = (limit,)
            base += " ORDER BY opened_at DESC LIMIT ?"
            for r in conn.execute(base, params).fetchall():
                if filt == "live" and r["trade_mode"] != "live":
                    continue
                events.append(
                    {
                        "id": f"open_{r['id']}",
                        "timestamp": r["opened_at"],
                        "type": "opened",
                        "ticker": r["ticker"],
                        "detail": (
                            f"{r['direction']} @ {_fmt_price(float(r['entry_price'] or 0))} "
                            f"{float(r['leverage'] or 1):.0f}x"
                            f" · conf {int(r['confidence'] or 0)}"
                        ),
                        "trade_mode": r["trade_mode"],
                    }
                )

        # 2. Position closes
        if filt in ("all", "live", "trades"):
            base = (
                "SELECT id, closed_at, ticker, direction, exit_reason, "
                "pnl_pct, pnl_usd, trade_mode FROM auto_trades "
                "WHERE closed_at IS NOT NULL"
            )
            if has_since:
                base += " AND datetime(closed_at) > datetime(?)"
                params = (since_iso, limit)
            else:
                params = (limit,)
            base += " ORDER BY closed_at DESC LIMIT ?"
            for r in conn.execute(base, params).fetchall():
                if filt == "live" and r["trade_mode"] != "live":
                    continue
                pnl_pct = float(r["pnl_pct"] or 0)
                pnl_usd = float(r["pnl_usd"] or 0)
                exit_reason = (r["exit_reason"] or "—").replace("_", " ")
                events.append(
                    {
                        "id": f"close_{r['id']}",
                        "timestamp": r["closed_at"],
                        "type": "closed",
                        "ticker": r["ticker"],
                        "detail": (
                            f"{r['direction']} {_fmt_signed_pct(pnl_pct)}% "
                            f"({_fmt_signed_usd(pnl_usd)}) · {exit_reason}"
                        ),
                        "trade_mode": r["trade_mode"],
                    }
                )

        # 3. Signals accepted (active_signal_cards posted)
        if filt in ("all",):
            base = (
                "SELECT id, posted_at, ticker, direction, original_confidence "
                "FROM active_signal_cards"
            )
            if has_since:
                base += " WHERE datetime(posted_at) > datetime(?)"
                params = (since_iso, limit)
            else:
                params = (limit,)
            base += " ORDER BY posted_at DESC LIMIT ?"
            for r in conn.execute(base, params).fetchall():
                events.append(
                    {
                        "id": f"accepted_{r['id']}",
                        "timestamp": r["posted_at"],
                        "type": "accepted",
                        "ticker": r["ticker"],
                        "detail": (
                            f"{r['direction']} signal posted at conf "
                            f"{float(r['original_confidence'] or 0):.0f}"
                        ),
                        "trade_mode": None,
                    }
                )

        # 4. Signals rejected
        if filt in ("all", "rejections"):
            base = (
                "SELECT id, last_updated_at, posted_at, ticker, direction, "
                "original_confidence, current_confidence, removed_reason "
                "FROM active_signal_cards "
                "WHERE removed_reason IS NOT NULL "
                "AND last_updated_at IS NOT NULL"
            )
            if has_since:
                base += " AND datetime(last_updated_at) > datetime(?)"
                params = (since_iso, limit)
            else:
                params = (limit,)
            base += " ORDER BY last_updated_at DESC LIMIT ?"
            for r in conn.execute(base, params).fetchall():
                orig = float(r["original_confidence"] or 0)
                cur = float(r["current_confidence"] or 0)
                reason = (r["removed_reason"] or "").split(" (")[0]
                events.append(
                    {
                        "id": f"rejected_{r['id']}",
                        "timestamp": r["last_updated_at"],
                        "type": "rejected",
                        "ticker": r["ticker"],
                        "detail": (
                            f"{r['direction']} {reason} · {orig:.0f}→{cur:.0f}"
                        ),
                        "trade_mode": None,
                    }
                )

        # Sort all events by timestamp DESC, take limit
        # SQLite ISO comparison is fine within same source; Python sort
        # uses string comparison which is correct for normalized ISO formats.
        events.sort(key=lambda e: e.get("timestamp") or "", reverse=True)
        return events[:limit]
    finally:
        conn.close()


def main() -> int:
    limit = 50
    since_iso = None
    filt = "all"

    args = sys.argv[1:]
    if len(args) >= 1:
        try:
            limit = max(1, min(200, int(args[0])))
        except (ValueError, TypeError):
            pass
    if len(args) >= 2:
        s = (args[1] or "").strip()
        if "T" in s or " " in s:
            since_iso = s
    if len(args) >= 3:
        f = (args[2] or "").strip().lower()
        if f in ALLOWED_FILTERS:
            filt = f

    try:
        events = query_activity(limit=limit, since_iso=since_iso, filt=filt)
        out = {
            "events": events,
            "queried_at": int(time.time()),
            "filter": filt,
        }
        print(json.dumps(out))
        return 0
    except Exception as e:
        print(
            json.dumps(
                {
                    "events": [],
                    "queried_at": int(time.time()),
                    "filter": filt,
                    "error": str(e),
                }
            )
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
