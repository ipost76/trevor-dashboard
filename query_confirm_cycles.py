#!/usr/bin/env python3
"""
query_confirm_cycles.py — Read-only state for the Momentum Confirm Cycles
production gate (B3, 2026-05-27). Backs GET /api/auto/exit-controls.

Returns:
  - promoted              CONFIRM_CYCLES_PROMOTED (production gate on/off)
  - confirm_cycles        MOMENTUM_EXIT_CONFIRM_CYCLES (window size N)
  - toggle_enabled        HUB_CONFIRM_CYCLES_TOGGLE_ENABLED (Hub write gate)
  - shadow_enabled        MOMENTUM_EXIT_CONFIRM_SHADOW (always-on logger flag)
  - audit                 last 5 rows from autotrader_state_audit filtered to
                          confirm_cycles_on / confirm_cycles_off actions
                          (reuses the existing audit table per Ghost ruling
                          so the toggle surfaces in AutoTrader Control's
                          "Recent Toggles" list automatically).

NOT a write path — see set_confirm_cycles_promoted.py.
"""
import json
import sqlite3

DB_PATH = "/home/trevor/trevor/trevor.db"
DB_RO_URI = f"file:{DB_PATH}?mode=ro"


def _conn_ro() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_RO_URI, uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def _bool_from_config(conn: sqlite3.Connection, key: str, default: bool = False) -> bool:
    row = conn.execute(
        "SELECT value FROM auto_config WHERE key=?", (key,),
    ).fetchone()
    if not row:
        return default
    return (row["value"] or "").strip().lower() == "true"


def _int_from_config(conn: sqlite3.Connection, key: str, default: int = 0) -> int:
    row = conn.execute(
        "SELECT value FROM auto_config WHERE key=?", (key,),
    ).fetchone()
    if not row:
        return default
    try:
        return int(float(row["value"] or "0"))
    except (ValueError, TypeError):
        return default


def _audit_rows(conn: sqlite3.Connection) -> list[dict]:
    """Last 5 confirm_cycles_* audit rows. Table may not exist on a fresh DB
    before the first toggle write — return [] if missing."""
    try:
        rows = conn.execute(
            "SELECT id, action, prev_value, new_value, source, timestamp "
            "FROM autotrader_state_audit "
            "WHERE action IN ('confirm_cycles_on', 'confirm_cycles_off') "
            "ORDER BY id DESC LIMIT 5"
        ).fetchall()
        return [dict(r) for r in rows]
    except sqlite3.OperationalError:
        return []


def main() -> None:
    payload: dict = {
        "promoted": False,
        "confirm_cycles": 0,
        "toggle_enabled": False,
        "shadow_enabled": False,
        "audit": [],
    }
    try:
        with _conn_ro() as conn:
            payload["promoted"] = _bool_from_config(conn, "CONFIRM_CYCLES_PROMOTED")
            payload["confirm_cycles"] = _int_from_config(conn, "MOMENTUM_EXIT_CONFIRM_CYCLES", default=2)
            payload["toggle_enabled"] = _bool_from_config(conn, "HUB_CONFIRM_CYCLES_TOGGLE_ENABLED")
            payload["shadow_enabled"] = _bool_from_config(conn, "MOMENTUM_EXIT_CONFIRM_SHADOW")
            payload["audit"] = _audit_rows(conn)
    except Exception as e:
        payload["error"] = str(e)
    print(json.dumps(payload, default=str))


if __name__ == "__main__":
    main()
