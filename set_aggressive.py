#!/usr/bin/env python3
"""
set_aggressive.py — Flag-gated Aggressive Mode toggle for /api/memory/aggressive POST.

Usage:
    set_aggressive.py <true|false> <author>

Behavior:
    1. Refuse if HUB_AGGRESSIVE_TOGGLE_ENABLED != 'true' (exit 3, gate locked).
    2. Read current aggressive_mode_config.enabled. If matches requested →
       no-op (still exit 0, no audit row, no command queued).
    3. Otherwise:
         a) Insert hub_commands row (AGGRESSIVE_ON / AGGRESSIVE_OFF). The
            bot's hub_close_poll_loop applies the change to
            aggressive_mode_config within ~10s.
         b) Insert aggressive_mode_history audit row (event_type=enable|disable,
            actor=<author>, reason='g2_hub_toggle:<author>').

Both writes commit in a single transaction so the audit and the queued
command are atomic.

Exit codes:
    0  success (toggled or idempotent no-op)
    1  usage error / bad value
    2  DB / unexpected error
    3  toggle disabled (HUB_AGGRESSIVE_TOGGLE_ENABLED is false)
"""
import json
import sqlite3
import sys

DB_PATH = "/home/trevor/trevor/trevor.db"
SENTINEL_TRADE_ID = "__GLOBAL_AGGRESSIVE__"
DEFAULT_DELTA = -5
DEFAULT_HOURS = 48.0


def _emit(payload: dict, code: int = 0) -> None:
    print(json.dumps(payload))
    sys.exit(code)


def _conn_rw() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def main() -> None:
    if len(sys.argv) < 3:
        _emit(
            {"ok": False, "error": "Usage: set_aggressive.py <true|false> <author>"},
            code=1,
        )

    raw = sys.argv[1].strip().lower()
    if raw not in ("true", "false"):
        _emit({"ok": False, "error": "value must be 'true' or 'false'"}, code=1)

    requested = raw == "true"
    author = (sys.argv[2] or "").strip() or "unknown"

    try:
        with _conn_rw() as conn:
            # 1. Flag gate
            row = conn.execute(
                "SELECT value FROM auto_config WHERE key='HUB_AGGRESSIVE_TOGGLE_ENABLED'"
            ).fetchone()
            gate_on = bool(row) and (row["value"] or "false").strip().lower() == "true"
            if not gate_on:
                _emit(
                    {
                        "ok": False,
                        "gate_locked": True,
                        "error": "HUB_AGGRESSIVE_TOGGLE_ENABLED is false",
                    },
                    code=3,
                )

            # 2. Read current state for idempotent check
            cur = conn.execute(
                "SELECT enabled FROM aggressive_mode_config WHERE id=1"
            ).fetchone()
            prev = bool(cur["enabled"]) if cur else False

            if prev == requested:
                _emit(
                    {
                        "ok": True,
                        "no_change": True,
                        "prev_value": str(prev).lower(),
                        "new_value": str(requested).lower(),
                    },
                    code=0,
                )

            # 3. Queue command + write audit row atomically
            command = "AGGRESSIVE_ON" if requested else "AGGRESSIVE_OFF"
            params = (
                {
                    "delta": DEFAULT_DELTA,
                    "hours": DEFAULT_HOURS,
                    "reason": f"g2_hub_toggle:{author}",
                }
                if requested
                else {"reason": f"g2_hub_toggle:{author}"}
            )
            cmd_cur = conn.execute(
                "INSERT INTO hub_commands (trade_id, command, params, status) "
                "VALUES (?, ?, ?, 'pending')",
                (SENTINEL_TRADE_ID, command, json.dumps(params)),
            )
            cmd_id = cmd_cur.lastrowid

            event_type = "enable" if requested else "disable"
            audit_cur = conn.execute(
                "INSERT INTO aggressive_mode_history "
                "(event_type, threshold_delta, duration_hours, actor, "
                " reason, signals_fired, timestamp) "
                "VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
                (
                    event_type,
                    DEFAULT_DELTA if requested else 0,
                    DEFAULT_HOURS if requested else None,
                    author,
                    f"g2_hub_toggle:{author}",
                    None,
                ),
            )
            audit_id = audit_cur.lastrowid

            conn.commit()

        _emit(
            {
                "ok": True,
                "no_change": False,
                "prev_value": str(prev).lower(),
                "new_value": str(requested).lower(),
                "command_id": cmd_id,
                "audit_id": audit_id,
                "queued": True,
                "note": "Bot poll loop applies within ~10s",
            },
            code=0,
        )
    except SystemExit:
        raise
    except Exception as e:
        _emit({"ok": False, "error": str(e)}, code=2)


if __name__ == "__main__":
    main()
