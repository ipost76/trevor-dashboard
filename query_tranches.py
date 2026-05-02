#!/usr/bin/env python3
"""Hub helper: get tranche history for a trade.

Usage:
    python3 query_tranches.py TRADE_ID
"""
import json
import sqlite3
import sys

DB_PATH = "/home/trevor/trevor/trevor.db"
sys.path.insert(0, "/home/trevor/trevor")


def get_conn():
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def run(trade_id: str):
    conn = get_conn()
    from position_scaling import get_trade_tranches
    result = get_trade_tranches(conn, trade_id)
    conn.close()

    if not result:
        print(json.dumps({"error": f"Trade not found: {trade_id}"}))
        return

    print(json.dumps(result))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: query_tranches.py TRADE_ID"}))
        sys.exit(1)
    run(sys.argv[1])
