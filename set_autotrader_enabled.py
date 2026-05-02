#!/usr/bin/env python3
"""
set_autotrader_enabled.py — Flag-gated AutoTrader on/off toggle for
/api/memory/autotrader-toggle POST. Per Rule 32 carve-out (2026-05-02).

Usage:
    set_autotrader_enabled.py <true|false> <author>

Behavior:
    1. Refuse if HUB_AUTOTRADER_TOGGLE_ENABLED != 'true' (exit 3, gate locked).
    2. Read current auto_config.AUTO_TRADER_ENABLED. If matches requested →
       no-op (still exit 0, no audit row, no DB write).
    3. Otherwise, in a single transaction:
         a) UPSERT auto_config.AUTO_TRADER_ENABLED to 'true' or 'false'.
            The bot's auto_trader/config.cfg_bool('AUTO_TRADER_ENABLED')
            picks up the change at the next signal (no restart).
         b) INSERT autotrader_state_audit row (action / prev_value /
            new_value / source='hub' / timestamp). Table created lazily
            on first call (additive — Rule 15).

Exit codes:
    0  success (toggled or idempotent no-op)
    1  usage error / bad value
    2  DB / unexpected error
    3  toggle disabled (HUB_AUTOTRADER_TOGGLE_ENABLED is false)

NOTE: Rule 1 + Rule 31 still binding — flipping OFF does NOT close any open
position, cancel any HL order, or restart any service. Only blocks NEW AT
entries. Manual signal cards in #scalp-signals continue to fire.
"""
import json
import sqlite3
import sys

DB_PATH = "/home/trevor/trevor/trevor.db"


def _emit(payload: dict, code: int = 0) -> None:
    print(json.dumps(payload))
    sys.exit(code)


def _conn_rw() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _ensure_audit_table(conn: sqlite3.Connection) -> None:
    """CREATE TABLE IF NOT EXISTS — additive only (Rule 15)."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS autotrader_state_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            prev_value TEXT,
            new_value TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'hub',
            timestamp TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)


def main() -> None:
    if len(sys.argv) < 3:
        _emit({"ok": False, "error": "Usage: set_autotrader_enabled.py <true|false> <author>"}, code=1)

    raw = sys.argv[1].strip().lower()
    if raw not in ("true", "false"):
        _emit({"ok": False, "error": "value must be 'true' or 'false'"}, code=1)

    requested = raw == "true"
    requested_str = "true" if requested else "false"
    author = (sys.argv[2] or "").strip() or "unknown"

    try:
        with _conn_rw() as conn:
            # 1. Flag gate
            row = conn.execute(
                "SELECT value FROM auto_config WHERE key='HUB_AUTOTRADER_TOGGLE_ENABLED'"
            ).fetchone()
            gate_on = bool(row) and (row["value"] or "false").strip().lower() == "true"
            if not gate_on:
                _emit(
                    {
                        "ok": False,
                        "gate_locked": True,
                        "error": "HUB_AUTOTRADER_TOGGLE_ENABLED is false",
                    },
                    code=3,
                )

            # 2. Read current state for idempotent check. Bot defaults to
            # 'false' at config.py:38 if the row is missing — mirror that.
            cur = conn.execute(
                "SELECT value FROM auto_config WHERE key='AUTO_TRADER_ENABLED'"
            ).fetchone()
            prev_str = (cur["value"] or "false").strip().lower() if cur else "false"
            prev = prev_str == "true"

            if prev == requested:
                _emit(
                    {
                        "ok": True,
                        "no_change": True,
                        "prev_value": prev_str,
                        "new_value": requested_str,
                    },
                    code=0,
                )

            # 3. Atomic write: flip the bot-read flag + audit row.
            _ensure_audit_table(conn)

            conn.execute(
                "INSERT OR REPLACE INTO auto_config(key, value) VALUES (?, ?)",
                ("AUTO_TRADER_ENABLED", requested_str),
            )

            action = "start" if requested else "pause"
            audit_cur = conn.execute(
                "INSERT INTO autotrader_state_audit "
                "(action, prev_value, new_value, source, timestamp) "
                "VALUES (?, ?, ?, ?, datetime('now'))",
                (action, prev_str, requested_str, f"hub:{author}"),
            )
            audit_id = audit_cur.lastrowid
            conn.commit()

        _emit(
            {
                "ok": True,
                "no_change": False,
                "action": action,
                "prev_value": prev_str,
                "new_value": requested_str,
                "audit_id": audit_id,
                "note": "Bot picks up via cfg_bool('AUTO_TRADER_ENABLED') at next signal",
            },
            code=0,
        )
    except SystemExit:
        raise
    except Exception as e:
        _emit({"ok": False, "error": str(e)}, code=2)


if __name__ == "__main__":
    main()
