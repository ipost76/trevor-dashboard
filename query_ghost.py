"""Ghost workspace CRUD — handles all ghost_* tables for Hub /obsidian page.
Only touches ghost_* tables. Never reads/writes TREVOR tables."""
import sqlite3
import json
import sys
from datetime import datetime

DB_PATH = "/home/trevor/trevor/trevor.db"

def get_conn():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def init_tables():
    conn = get_conn()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS ghost_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('LONG','SHORT')),
        entry_price REAL, exit_price REAL, leverage REAL DEFAULT 1.0,
        stop_loss REAL, target REAL, pnl_pct REAL,
        outcome TEXT CHECK(outcome IN ('WIN','LOSS','SCRATCH','OPEN',NULL)),
        notes TEXT, tags TEXT, source TEXT DEFAULT 'manual',
        opened_at TEXT DEFAULT (datetime('now')),
        closed_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ghost_strategies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL, content TEXT NOT NULL,
        category TEXT, tags TEXT,
        status TEXT DEFAULT 'active' CHECK(status IN ('active','testing','retired','idea')),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ghost_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL, content TEXT NOT NULL,
        category TEXT, tags TEXT,
        pinned INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );
    -- ghost_training and ghost_tasks removed (2026-03-30 GCC overhaul)
    """)
    conn.commit()
    conn.close()

def row_to_dict(row):
    return dict(row) if row else None

def rows_to_list(rows):
    return [dict(r) for r in rows]

# ── GENERIC CRUD ─────────────────────────────────────────────────
def list_items(table, filters=None, order="created_at DESC", limit=50, offset=0):
    conn = get_conn()
    where_parts, params = [], []
    if filters:
        for k, v in filters.items():
            if v:
                where_parts.append(f"{k} = ?")
                params.append(v)
    where_clause = "WHERE " + " AND ".join(where_parts) if where_parts else ""
    sql = f"SELECT * FROM {table} {where_clause} ORDER BY {order} LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    rows = conn.execute(sql, params).fetchall()
    total = conn.execute(f"SELECT COUNT(*) FROM {table} {where_clause}", params[:-2]).fetchone()[0]
    conn.close()
    return {"items": rows_to_list(rows), "total": total}

def get_item(table, item_id):
    conn = get_conn()
    row = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (item_id,)).fetchone()
    conn.close()
    return row_to_dict(row)

def create_item(table, data):
    conn = get_conn()
    cols = ", ".join(data.keys())
    placeholders = ", ".join("?" for _ in data)
    cur = conn.execute(f"INSERT INTO {table} ({cols}) VALUES ({placeholders})", list(data.values()))
    conn.commit()
    row = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return row_to_dict(row)

def update_item(table, item_id, data):
    conn = get_conn()
    data["updated_at"] = datetime.utcnow().isoformat()
    sets = ", ".join(f"{k} = ?" for k in data.keys())
    conn.execute(f"UPDATE {table} SET {sets} WHERE id = ?", list(data.values()) + [item_id])
    conn.commit()
    row = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (item_id,)).fetchone()
    conn.close()
    return row_to_dict(row)

def delete_item(table, item_id):
    conn = get_conn()
    conn.execute(f"DELETE FROM {table} WHERE id = ?", (item_id,))
    conn.commit()
    conn.close()
    return {"deleted": True, "id": item_id}

# ── TRADES SPECIAL: auto-calc P&L on close ──────────────────────
def close_trade(trade_id, exit_price):
    conn = get_conn()
    trade = conn.execute("SELECT * FROM ghost_trades WHERE id = ?", (trade_id,)).fetchone()
    if not trade:
        conn.close()
        return {"error": "Trade not found"}
    entry = trade["entry_price"]
    lev = trade["leverage"] or 1.0
    direction = trade["direction"]
    if entry and exit_price:
        if direction == "LONG":
            pnl = (exit_price - entry) / entry * 100 * lev
        else:
            pnl = (entry - exit_price) / entry * 100 * lev
        outcome = "WIN" if pnl > 0 else "LOSS" if pnl < 0 else "SCRATCH"
    else:
        pnl = 0
        outcome = "SCRATCH"
    now = datetime.utcnow().isoformat()
    conn.execute(
        "UPDATE ghost_trades SET exit_price=?, pnl_pct=?, outcome=?, closed_at=?, updated_at=? WHERE id=?",
        (exit_price, round(pnl, 2), outcome, now, now, trade_id)
    )
    conn.commit()
    row = conn.execute("SELECT * FROM ghost_trades WHERE id = ?", (trade_id,)).fetchone()
    conn.close()
    return row_to_dict(row)

# ── TRADE STATS ──────────────────────────────────────────────────
def trade_stats():
    conn = get_conn()
    total = conn.execute("SELECT COUNT(*) FROM ghost_trades").fetchone()[0]
    wins = conn.execute("SELECT COUNT(*) FROM ghost_trades WHERE outcome='WIN'").fetchone()[0]
    losses = conn.execute("SELECT COUNT(*) FROM ghost_trades WHERE outcome='LOSS'").fetchone()[0]
    open_count = conn.execute("SELECT COUNT(*) FROM ghost_trades WHERE outcome IS NULL OR outcome='OPEN'").fetchone()[0]
    avg_pnl_row = conn.execute("SELECT AVG(pnl_pct) FROM ghost_trades WHERE pnl_pct IS NOT NULL").fetchone()
    avg_pnl = round(avg_pnl_row[0], 2) if avg_pnl_row[0] else 0
    conn.close()
    closed = wins + losses + (total - open_count - wins - losses)
    wr = round(wins / closed * 100, 1) if closed > 0 else 0
    return {"total": total, "wins": wins, "losses": losses, "open": open_count, "win_rate": wr, "avg_pnl": avg_pnl}

# ── MAIN DISPATCH ────────────────────────────────────────────────
if __name__ == "__main__":
    init_tables()
    args = sys.argv[1:]
    if len(args) < 2:
        print(json.dumps({"error": "Usage: query_ghost.py <table> <action> [args...]"}))
        sys.exit(1)

    table_map = {
        "trades": "ghost_trades",
        "strategies": "ghost_strategies",
        "notes": "ghost_notes",
    }
    table_key = args[0]
    action = args[1]
    table = table_map.get(table_key)

    if not table and action != "stats":
        print(json.dumps({"error": f"Unknown table: {table_key}"}))
        sys.exit(1)

    try:
        if action == "list":
            filters_json = args[2] if len(args) > 2 else "{}"
            filters = json.loads(filters_json)
            order = args[3] if len(args) > 3 else "created_at DESC"
            limit = int(args[4]) if len(args) > 4 else 50
            offset = int(args[5]) if len(args) > 5 else 0
            # Special sort for tasks
            if table_key == "tasks":
                order = "CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, created_at DESC"
            # Notes: pinned first
            if table_key == "notes":
                order = "pinned DESC, created_at DESC"
            result = list_items(table, filters, order, limit, offset)

        elif action == "get":
            item_id = int(args[2])
            result = get_item(table, item_id)
            if not result:
                result = {"error": "Not found"}

        elif action == "create":
            data = json.loads(args[2])
            result = create_item(table, data)

        elif action == "update":
            item_id = int(args[2])
            data = json.loads(args[3])
            # Auto-set completed fields
            if table_key == "tasks" and data.get("status") == "done":
                data["completed_at"] = datetime.utcnow().isoformat()
            if table_key == "training" and data.get("status") == "completed":
                data["completed_at"] = datetime.utcnow().isoformat()
                data["progress_pct"] = 100
            result = update_item(table, item_id, data)

        elif action == "delete":
            item_id = int(args[2])
            result = delete_item(table, item_id)

        elif action == "close_trade":
            trade_id = int(args[2])
            exit_price = float(args[3])
            result = close_trade(trade_id, exit_price)

        elif action == "stats":
            if table_key == "trades":
                result = trade_stats()
            else:
                result = {"error": "No stats for this table"}

        else:
            result = {"error": f"Unknown action: {action}"}

        print(json.dumps(result, default=str))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
