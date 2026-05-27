#!/usr/bin/env python3
"""
query_live_partials_enabled.py — Read-only LIVE_PARTIALS_ENABLED state for
/api/auto/partials-toggle GET (B4, 2026-05-27). Mirrors
query_autotrader_enabled.py / query_confirm_cycles.py pattern.

Returns the live state of auto_config.LIVE_PARTIALS_ENABLED, the
HUB_LIVE_PARTIALS_TOGGLE_ENABLED gate flag (defense-in-depth: lock the
UI write surface independently of the underlying feature flag), the
EMERGENCY_KILLSWITCH state (informational), and the last 5 partial-toggle
audit rows from autotrader_state_audit (filtered on action LIKE
'live_partials_%'). Read-only — see set_live_partials_enabled.py.

Output JSON shape:
  {
    "enabled": bool,            # LIVE_PARTIALS_ENABLED
    "toggle_enabled": bool,     # HUB_LIVE_PARTIALS_TOGGLE_ENABLED gate
    "killswitch_enabled": bool, # EMERGENCY_KILLSWITCH (informational)
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
    """Read last 5 partial-toggle audit rows from autotrader_state_audit.
    Filtered on action LIKE 'live_partials_%' so only B4 events surface
    in this card. Table is created lazily by set_autotrader_enabled.py
    on first write — return [] if it doesn't exist yet."""
    try:
        rows = conn.execute(
            "SELECT id, action, prev_value, new_value, source, timestamp "
            "FROM autotrader_state_audit "
            "WHERE action LIKE 'live_partials_%' "
            "ORDER BY id DESC LIMIT 5"
        ).fetchall()
        return [dict(r) for r in rows]
    except sqlite3.OperationalError:
        return []


def main() -> None:
    payload: dict = {
        "enabled": False,           # auto_trader/config.py default
        "toggle_enabled": False,    # gate defaults locked
        "killswitch_enabled": False,
        "audit": [],
    }
    try:
        with _conn_ro() as conn:
            payload["enabled"] = _bool_from_config(conn, "LIVE_PARTIALS_ENABLED")
            payload["toggle_enabled"] = _bool_from_config(conn, "HUB_LIVE_PARTIALS_TOGGLE_ENABLED")
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
