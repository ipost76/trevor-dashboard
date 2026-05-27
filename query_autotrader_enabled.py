#!/usr/bin/env python3
"""
query_autotrader_enabled.py — Read-only AutoTrader on/off state for
/api/memory/autotrader-toggle GET. Per Rule 32 carve-out (2026-05-02).

Returns the live state of auto_config.AUTO_TRADER_ENABLED (hot-reloaded by
auto_trader/config.cfg_bool at every signal), the HUB_AUTOTRADER_TOGGLE_ENABLED
gate flag (controls whether the Hub UI may write a toggle), the
EMERGENCY_KILLSWITCH state (informational; killswitch ON also blocks AT entries
but the two flags are independent), and the last 5 audit rows from
autotrader_state_audit. NOT a write path — see set_autotrader_enabled.py.

Output JSON shape:
  {
    "enabled": bool,                    # AUTO_TRADER_ENABLED
    "toggle_enabled": bool,             # HUB_AUTOTRADER_TOGGLE_ENABLED gate
    "killswitch_enabled": bool,         # EMERGENCY_KILLSWITCH (informational)
    "audit": [ { id, action, prev_value, new_value, source, timestamp } x ≤5 ]
  }
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


def _audit_rows(conn: sqlite3.Connection) -> list[dict]:
    """Read last 5 audit rows. Table is created lazily by set_autotrader_enabled
    on first write — return [] if it doesn't exist yet."""
    try:
        rows = conn.execute(
            "SELECT id, action, prev_value, new_value, source, timestamp "
            "FROM autotrader_state_audit "
            "ORDER BY id DESC LIMIT 5"
        ).fetchall()
        return [dict(r) for r in rows]
    except sqlite3.OperationalError:
        return []


def main() -> None:
    payload: dict = {
        "enabled": True,           # auto_trader/config.py default
        "toggle_enabled": False,   # gate defaults locked
        "killswitch_enabled": False,
        "audit": [],
    }
    try:
        with _conn_ro() as conn:
            payload["enabled"] = _bool_from_config(conn, "AUTO_TRADER_ENABLED", default=True)
            payload["toggle_enabled"] = _bool_from_config(conn, "HUB_AUTOTRADER_TOGGLE_ENABLED")
            payload["killswitch_enabled"] = _bool_from_config(conn, "EMERGENCY_KILLSWITCH")
            payload["audit"] = _audit_rows(conn)
    except Exception as e:
        payload["error"] = str(e)
    print(json.dumps(payload, default=str))


if __name__ == "__main__":
    # OUTER-WRAP: 2026-05-27 (silent-crash visibility)
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        main()

    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
