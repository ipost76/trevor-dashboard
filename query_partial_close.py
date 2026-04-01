#!/usr/bin/env python3
"""Hub helper: execute partial close on a trade.

Usage:
    python3 query_partial_close.py TRADE_ID AMOUNT [PRICE]
    If PRICE omitted, fetches current from Hyperliquid.
"""
import json
import sqlite3
import sys

DB_PATH = "/home/trevor/trevor/trevor.db"
sys.path.insert(0, "/home/trevor/trevor")


def get_conn():
    conn = sqlite3.connect(DB_PATH)
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

    from position_scaling import execute_partial_close
    try:
        result = execute_partial_close(conn, trade_id, amount, price)
    except ValueError as e:
        print(json.dumps({"error": str(e)}))
        conn.close()
        return

    conn.close()
    print(json.dumps({
        "success": True,
        "partial": {
            "amount_closed": amount,
            "close_price": price,
            "pnl_pct": round(result["pnl_pct"], 2),
            "pnl_usd": round(result["pnl_usd"], 4),
        },
        "trade": {
            "remaining_margin": round(result["new_remaining"], 2),
            "total_realized_pnl": round(result["new_realized"], 4),
            "partials_count": result["new_partials"],
            "fully_closed": result["is_fully_closed"],
        },
    }))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: query_partial_close.py TRADE_ID AMOUNT [PRICE]"}))
        sys.exit(1)
    _trade_id = sys.argv[1]
    _amount = float(sys.argv[2])
    _price = float(sys.argv[3]) if len(sys.argv) > 3 else None
    run(_trade_id, _amount, _price)
