#!/usr/bin/env python3
"""Hub helper: add to an existing position.

Usage:
    python3 query_add_position.py TRADE_ID AMOUNT [PRICE]
    If PRICE omitted, fetches current from Hyperliquid.
"""
import json
import sqlite3
import sys

DB_PATH = "/home/trevor/trevor/trevor.db"
sys.path.insert(0, "/home/trevor/trevor")


def get_conn():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def run(trade_id: str, amount: float, price: float | None):
    conn = get_conn()

    # Verify trade exists and is open
    trade = conn.execute(
        "SELECT trade_id, ticker, status FROM active_trades WHERE trade_id = ? AND status = 'open'",
        (trade_id,),
    ).fetchone()
    if not trade:
        print(json.dumps({"error": f"No open trade with id {trade_id}"}))
        conn.close()
        return

    # Fetch price if not provided
    if price is None:
        from hyperliquid_data import get_current_price
        price = get_current_price(trade["ticker"])
        if price is None:
            print(json.dumps({"error": f"Could not fetch current price for {trade['ticker']}"}))
            conn.close()
            return

    from position_scaling import execute_add_position
    try:
        result = execute_add_position(conn, trade_id, amount, price)
    except ValueError as e:
        print(json.dumps({"error": str(e)}))
        conn.close()
        return

    conn.close()
    print(json.dumps({
        "success": True,
        "addition": {
            "amount_added": amount,
            "add_price": price,
            "avg_entry_before": round(result["old_avg_entry"], 6),
            "avg_entry_after": round(result["new_avg_entry"], 6),
        },
        "trade": {
            "avg_entry_price": round(result["new_avg_entry"], 6),
            "remaining_margin": round(result["new_remaining"], 2),
            "total_margin": round(result["new_total_margin"], 2),
            "additions_count": result["new_additions_count"],
            "target_price": result["new_target"],
        },
    }))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: query_add_position.py TRADE_ID AMOUNT [PRICE]"}))
        sys.exit(1)
    _trade_id = sys.argv[1]
    _amount = float(sys.argv[2])
    _price = float(sys.argv[3]) if len(sys.argv) > 3 else None
    run(_trade_id, _amount, _price)
