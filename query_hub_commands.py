#!/usr/bin/env python3
"""Hub helper: submit trade commands (HOLD, FLIP) and query exit signals."""
import json
import sqlite3
import sys

DB_PATH = "/home/trevor/trevor/trevor.db"


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def submit_command(trade_id: str, command: str, params_json: str = "{}"):
    """Submit a HOLD or FLIP command to the queue."""
    conn = get_conn()
    trade = conn.execute(
        "SELECT trade_id, ticker, direction FROM active_trades WHERE trade_id=? AND status='open'",
        (trade_id,),
    ).fetchone()
    if not trade:
        print(json.dumps({"error": f"No open trade with id {trade_id}"}))
        conn.close()
        return
    existing = conn.execute(
        "SELECT id FROM hub_commands WHERE trade_id=? AND status IN ('pending','processing')",
        (trade_id,),
    ).fetchone()
    if existing:
        print(json.dumps({"error": "Command already pending for this trade"}))
        conn.close()
        return
    conn.execute(
        "INSERT INTO hub_commands (trade_id, command, params) VALUES (?, ?, ?)",
        (trade_id, command, params_json),
    )
    conn.commit()
    print(json.dumps({"ok": True, "trade_id": trade_id, "command": command}))
    conn.close()


def command_status(trade_id: str):
    """Check status of most recent command for a trade."""
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM hub_commands WHERE trade_id=? ORDER BY created_at DESC LIMIT 1",
        (trade_id,),
    ).fetchone()
    conn.close()
    if not row:
        print(json.dumps({"status": "none"}))
        return
    row = dict(row)
    result = {"id": row["id"], "status": row["status"], "command": row["command"]}
    if row.get("result_json"):
        try:
            result["result"] = json.loads(row["result_json"])
        except Exception:
            result["result"] = row["result_json"]
    print(json.dumps(result))


def exit_signals(ticker: str = None, limit: int = 50):
    """Query exit signal history."""
    conn = get_conn()
    if ticker:
        rows = conn.execute(
            "SELECT * FROM exit_signals WHERE ticker LIKE ? ORDER BY created_at DESC LIMIT ?",
            (f"%{ticker}%", limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM exit_signals ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    conn.close()
    print(json.dumps({"signals": [dict(r) for r in rows]}))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: query_hub_commands.py submit|status|exit_signals ..."}))
        sys.exit(1)
    action = sys.argv[1]
    if action == "submit":
        submit_command(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else "{}")
    elif action == "status":
        command_status(sys.argv[2])
    elif action == "exit_signals":
        ticker = sys.argv[2] if len(sys.argv) > 2 else None
        limit = int(sys.argv[3]) if len(sys.argv) > 3 else 50
        exit_signals(ticker, limit)
    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))
