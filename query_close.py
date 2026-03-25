#!/usr/bin/env python3
"""Hub helper: manage trade close requests via SQLite queue.

Usage:
    python3 query_close.py submit TRADE_ID EXIT_PRICE
    python3 query_close.py status TRADE_ID
"""
import json
import sqlite3
import sys

DB_PATH = "/home/trevor/trevor/trevor.db"


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def submit_close(trade_id: str, exit_price: float):
    """Insert a close request into the queue."""
    conn = get_conn()
    # Verify the trade exists and is open
    trade = conn.execute(
        "SELECT trade_id, ticker, direction, entry_price, leverage, track "
        "FROM active_trades WHERE trade_id = ? AND status = 'open'",
        (trade_id,),
    ).fetchone()
    if not trade:
        print(json.dumps({"error": f"No open trade with id {trade_id}"}))
        return

    # Check for existing pending request
    existing = conn.execute(
        "SELECT id FROM close_requests WHERE trade_id = ? AND status IN ('pending', 'processing')",
        (trade_id,),
    ).fetchone()
    if existing:
        print(json.dumps({"error": "Close request already pending for this trade"}))
        conn.close()
        return

    conn.execute(
        "INSERT INTO close_requests (trade_id, exit_price) VALUES (?, ?)",
        (trade_id, exit_price),
    )
    conn.commit()

    trade = dict(trade)
    entry = trade.get("entry_price", 0) or 0
    direction = trade.get("direction", "LONG")
    leverage = trade.get("leverage", 1.0) or 1.0

    # Preview P&L
    if entry > 0:
        if direction.upper() == "SHORT":
            raw_pnl = ((entry - exit_price) / entry) * 100
        else:
            raw_pnl = ((exit_price - entry) / entry) * 100
        lev_pnl = raw_pnl * leverage
    else:
        raw_pnl = 0
        lev_pnl = 0

    print(json.dumps({
        "ok": True,
        "trade_id": trade_id,
        "ticker": trade["ticker"],
        "direction": direction,
        "entry": entry,
        "exit_price": exit_price,
        "leverage": leverage,
        "preview_pnl": round(lev_pnl, 2),
    }))
    conn.close()


def check_status(trade_id: str):
    """Check the status of the most recent close request for a trade."""
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM close_requests WHERE trade_id = ? ORDER BY requested_at DESC LIMIT 1",
        (trade_id,),
    ).fetchone()
    conn.close()

    if not row:
        print(json.dumps({"status": "none", "message": "No close request found"}))
        return

    row = dict(row)
    result = {
        "id": row["id"],
        "trade_id": row["trade_id"],
        "exit_price": row["exit_price"],
        "status": row["status"],
        "requested_at": row["requested_at"],
    }
    if row.get("result_json"):
        try:
            result["result"] = json.loads(row["result_json"])
        except (json.JSONDecodeError, TypeError):
            result["result"] = row["result_json"]

    print(json.dumps(result))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: query_close.py submit|status TRADE_ID [EXIT_PRICE]"}))
        sys.exit(1)

    action = sys.argv[1]
    if action == "submit":
        if len(sys.argv) < 4:
            print(json.dumps({"error": "Usage: query_close.py submit TRADE_ID EXIT_PRICE"}))
            sys.exit(1)
        submit_close(sys.argv[2], float(sys.argv[3]))
    elif action == "status":
        check_status(sys.argv[2])
    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))
        sys.exit(1)
