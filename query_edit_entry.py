#!/usr/bin/env python3
"""Edit entry price for an active trade. Direct DB write + return trade data for Discord card rebuild."""
import json
import os
import sqlite3
import sys


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: query_edit_entry.py <trade_id> <new_entry_price>"}))
        return

    trade_id = sys.argv[1]
    try:
        new_entry = float(sys.argv[2])
    except ValueError:
        print(json.dumps({"error": f"Invalid price: {sys.argv[2]}"}))
        return

    if new_entry <= 0:
        print(json.dumps({"error": "Price must be positive"}))
        return

    db_path = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")
    conn = sqlite3.connect(db_path, timeout=10)
    conn.row_factory = sqlite3.Row

    # Get the trade first
    row = conn.execute(
        "SELECT * FROM active_trades WHERE trade_id = ? AND status = 'open'",
        (trade_id,),
    ).fetchone()

    if not row:
        print(json.dumps({"error": f"Trade {trade_id} not found or not open"}))
        conn.close()
        return

    old_entry = row["entry_price"]

    # Update entry price
    conn.execute(
        "UPDATE active_trades SET entry_price = ? WHERE trade_id = ? AND status = 'open'",
        (new_entry, trade_id),
    )
    conn.commit()

    # Return trade data for Discord card rebuild
    trade = dict(row)
    trade["entry_price"] = new_entry
    trade["old_entry_price"] = old_entry

    print(json.dumps({
        "ok": True,
        "trade_id": trade_id,
        "old_entry": old_entry,
        "new_entry": new_entry,
        "ticker": trade.get("ticker"),
        "direction": trade.get("direction"),
        "leverage": trade.get("leverage"),
        "stop_price": trade.get("stop_price"),
        "profit_target_price": trade.get("profit_target_price"),
        "card_msg_id": trade.get("card_msg_id"),
        "card_channel_id": trade.get("card_channel_id"),
    }))

    conn.close()


if __name__ == "__main__":
    main()
