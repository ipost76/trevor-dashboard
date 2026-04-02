#!/usr/bin/env python3
"""Hub helper: live board data — read tickers, add/remove from watchlist, enter trade.

Usage:
    python3 query_live_board.py read
    python3 query_live_board.py add TICKER
    python3 query_live_board.py remove TICKER
    python3 query_live_board.py enter TICKER DIRECTION PRICE
"""
import json
import sqlite3
import sys
from datetime import datetime, timezone

DB_PATH = "/home/trevor/trevor/trevor.db"
sys.path.insert(0, "/home/trevor/trevor")


def get_conn(readonly=False):
    if readonly:
        conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    else:
        conn = sqlite3.connect(DB_PATH)
        conn.execute("PRAGMA journal_mode=WAL")
    conn.row_factory = sqlite3.Row
    return conn


def read_board():
    conn = get_conn(readonly=True)
    rows = conn.execute(
        "SELECT ticker, direction, confidence, regime, current_price, "
        "momentum_score, trend_score, volume_score, volatility_score, "
        "microstructure_score, insight_line, updated_at "
        "FROM scalp_live_board ORDER BY ticker"
    ).fetchall()
    conn.close()
    tickers = [dict(r) for r in rows]
    last_scan = tickers[0]["updated_at"] if tickers else None
    print(json.dumps({"tickers": tickers, "last_scan": last_scan}))


def add_ticker(ticker: str):
    t = ticker.upper().strip()
    if not t:
        print(json.dumps({"error": "Ticker cannot be empty"}))
        return
    conn = get_conn()
    conn.execute(
        "INSERT OR IGNORE INTO scalp_watchlist (ticker) VALUES (?)", (t,)
    )
    conn.commit()
    rows = conn.execute("SELECT ticker FROM scalp_watchlist ORDER BY ticker").fetchall()
    conn.close()
    print(json.dumps({"ok": True, "watchlist": [r["ticker"] for r in rows]}))


def remove_ticker(ticker: str):
    t = ticker.upper().strip()
    conn = get_conn()
    conn.execute("DELETE FROM scalp_watchlist WHERE ticker = ?", (t,))
    conn.execute("DELETE FROM scalp_live_board WHERE ticker = ?", (t,))
    conn.commit()
    rows = conn.execute("SELECT ticker FROM scalp_watchlist ORDER BY ticker").fetchall()
    conn.close()
    print(json.dumps({"ok": True, "watchlist": [r["ticker"] for r in rows]}))


def enter_trade(ticker: str, direction: str, price: float):
    """Create a trade via hub_commands queue — bot picks it up and posts Discord card."""
    t = ticker.upper().strip()
    d = direction.upper().strip()
    if d not in ("LONG", "SHORT"):
        print(json.dumps({"error": f"Direction must be LONG or SHORT, got {d}"}))
        return
    if price <= 0:
        print(json.dumps({"error": "Price must be positive"}))
        return

    conn = get_conn()
    # Use a placeholder trade_id — bot will create the real one
    trade_id = f"{t}_HUB_{int(datetime.now(timezone.utc).timestamp())}"
    params = json.dumps({
        "ticker": t,
        "direction": d,
        "current_price": price,
    })
    conn.execute(
        "INSERT INTO hub_commands (trade_id, command, params) VALUES (?, 'ENTER', ?)",
        (trade_id, params),
    )
    conn.commit()

    # Get the command ID for status polling
    row = conn.execute(
        "SELECT id FROM hub_commands WHERE trade_id = ? ORDER BY created_at DESC LIMIT 1",
        (trade_id,),
    ).fetchone()
    cmd_id = row["id"] if row else None
    conn.close()

    print(json.dumps({
        "ok": True,
        "command_id": cmd_id,
        "trade_id": trade_id,
        "ticker": t,
        "direction": d,
        "entry_price": price,
        "message": "Trade queued \u2014 bot will post Discord card",
    }))


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "read"

    if action == "read":
        read_board()
    elif action == "add" and len(sys.argv) > 2:
        add_ticker(sys.argv[2])
    elif action == "remove" and len(sys.argv) > 2:
        remove_ticker(sys.argv[2])
    elif action == "enter" and len(sys.argv) > 4:
        enter_trade(sys.argv[2], sys.argv[3], float(sys.argv[4]))
    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))
