#!/usr/bin/env python3
"""Admin reset operations for capital and P&L stats."""
import json
import os
import sqlite3
import sys
from datetime import datetime

try:
    import pytz
    ET = pytz.timezone("America/New_York")
except ImportError:
    ET = None

trevor_dir = os.environ.get("TREVOR_PROJECT_DIR", "/home/trevor/trevor")
db_path = os.environ.get("TREVOR_DB_PATH", os.path.join(trevor_dir, "trevor.db"))


def _now_et_iso():
    if ET:
        return datetime.now(ET).isoformat()
    return datetime.now().isoformat()


def _now_unix():
    return int(datetime.now().timestamp())


def current_state():
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        # Latest capital
        row = conn.execute(
            "SELECT new_value, reset_at FROM capital_resets WHERE reset_type='capital' ORDER BY reset_at_unix DESC LIMIT 1"
        ).fetchone()
        capital = float(row["new_value"]) if row else 50.0
        last_capital_reset = row["reset_at"] if row else None

        # Latest P&L cutoff
        pnl_row = conn.execute(
            "SELECT reset_at, reset_at_unix FROM capital_resets WHERE reset_type='pnl_stats' ORDER BY reset_at_unix DESC LIMIT 1"
        ).fetchone()
        pnl_cutoff_date = pnl_row["reset_at"] if pnl_row else None
        pnl_cutoff_unix = int(pnl_row["reset_at_unix"]) if pnl_row else None

        # Latest XP cutoff
        xp_row = conn.execute(
            "SELECT reset_at, reset_at_unix FROM capital_resets WHERE reset_type='xp' ORDER BY reset_at_unix DESC LIMIT 1"
        ).fetchone()
        xp_cutoff_date = xp_row["reset_at"] if xp_row else None
        xp_cutoff_unix = int(xp_row["reset_at_unix"]) if xp_row else None
    finally:
        conn.close()

    print(json.dumps({
        "currentCapital": capital,
        "pnlCutoffDate": pnl_cutoff_date,
        "pnlCutoffUnix": pnl_cutoff_unix,
        "lastCapitalReset": last_capital_reset,
        "xpCutoffDate": xp_cutoff_date,
        "xpCutoffUnix": xp_cutoff_unix,
    }))


def reset_capital(new_capital):
    new_capital = float(new_capital)
    conn = sqlite3.connect(db_path, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            "SELECT new_value FROM capital_resets WHERE reset_type='capital' ORDER BY reset_at_unix DESC LIMIT 1"
        ).fetchone()
        old_capital = row["new_value"] if row else "50.0"

        now_et = _now_et_iso()
        now_unix = _now_unix()
        conn.execute(
            "INSERT INTO capital_resets (reset_type, reset_at, reset_at_unix, old_value, new_value, notes) "
            "VALUES ('capital', ?, ?, ?, ?, ?)",
            (now_et, now_unix, old_capital, str(new_capital), f"Capital reset via Hub UI"),
        )
        # Also update trevor_config so the bot reads the new value
        conn.execute(
            "INSERT OR REPLACE INTO trevor_config (key, value, updated_at) VALUES ('trading_capital', ?, datetime('now'))",
            (str(new_capital),),
        )
        conn.commit()
    finally:
        conn.close()

    print(json.dumps({
        "success": True,
        "oldCapital": float(old_capital),
        "newCapital": new_capital,
        "resetAt": now_et,
    }))


def reset_pnl_stats():
    conn = sqlite3.connect(db_path, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        prev = conn.execute(
            "SELECT reset_at FROM capital_resets WHERE reset_type='pnl_stats' ORDER BY reset_at_unix DESC LIMIT 1"
        ).fetchone()
        old_value = prev["reset_at"] if prev else None

        now_et = _now_et_iso()
        now_unix = _now_unix()
        conn.execute(
            "INSERT INTO capital_resets (reset_type, reset_at, reset_at_unix, old_value, new_value, notes) "
            "VALUES ('pnl_stats', ?, ?, ?, ?, ?)",
            (now_et, now_unix, old_value, now_et, "P&L stats reset via Hub UI"),
        )
        conn.commit()
    finally:
        conn.close()

    print(json.dumps({
        "success": True,
        "newCutoff": now_et,
        "resetAt": now_et,
    }))


def reset_xp():
    conn = sqlite3.connect(db_path, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        # Read current lifetime XP for audit trail
        xp_row = conn.execute("SELECT COALESCE(SUM(amount), 0) FROM xp_ledger").fetchone()
        current_xp = int(xp_row[0]) if xp_row else 0

        now_et = _now_et_iso()
        now_unix = _now_unix()
        conn.execute(
            "INSERT INTO capital_resets (reset_type, reset_at, reset_at_unix, old_value, new_value, notes) "
            "VALUES ('xp', ?, ?, ?, ?, ?)",
            (now_et, now_unix, str(current_xp), now_et, "XP display reset via Hub UI"),
        )
        conn.commit()
    finally:
        conn.close()

    print(json.dumps({
        "success": True,
        "newCutoff": now_et,
        "resetAt": now_et,
        "previousXp": current_xp,
    }))


def reset_history():
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT id, reset_type, reset_at, old_value, new_value, notes "
            "FROM capital_resets ORDER BY reset_at_unix DESC LIMIT 50"
        ).fetchall()
    finally:
        conn.close()

    print(json.dumps({
        "resets": [dict(r) for r in rows],
    }))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "current_state"

    if cmd == "current_state":
        current_state()
    elif cmd == "reset_capital":
        reset_capital(sys.argv[2])
    elif cmd == "reset_pnl_stats":
        reset_pnl_stats()
    elif cmd == "reset_xp":
        reset_xp()
    elif cmd == "reset_history":
        reset_history()
    else:
        print(json.dumps({"error": f"Unknown command: {cmd}"}))
