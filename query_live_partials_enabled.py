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


def _tri_from_config(conn: sqlite3.Connection, key: str):
    """True / False / **None**, and None is the unknown value — never False.

    🚨 B1-MONEY-PATH-HONESTY (2026-08-04): replaces `_bool_from_config(conn,
    key, default)`, which resolved an absent row to a caller-supplied default
    and returned it as if it were a reading. Only a row we ACTUALLY READ may
    move this off None. LIVE_PARTIALS_ENABLED is money-path, which is exactly
    why its reader must be able to say it does not know."""
    row = conn.execute(
        "SELECT value FROM auto_config WHERE key=?", (key,),
    ).fetchone()
    if not row or row["value"] is None:
        return None
    return str(row["value"]).strip().lower() == "true"


def _state_of(v) -> str:
    """The discriminator beside every tri-state field."""
    return "unknown" if v is None else ("on" if v else "off")


def _audit_rows(conn: sqlite3.Connection):  # -> (rows, state) since B1
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
        return [dict(r) for r in rows], "ok"
    except sqlite3.OperationalError:
        return [], "table_absent"


def main() -> None:
    # 🚨 B1: THE UNKNOWN DEFAULT. Nothing below may set these to a confident
    # reading unless it has actually READ a row saying so. An unreadable
    # database used to be reported as `enabled:false, killswitch_enabled:false`
    # — a confident all-clear about a money-path control and the emergency
    # stop, sourced from no reading at all. Fail-soft is preserved; only the
    # value it fails soft TO has changed. Every field is kept present and
    # populated, and `error` in particular stays exactly where it was.
    payload: dict = {
        "enabled": None,
        "toggle_enabled": None,
        "killswitch_enabled": None,
        "enabled_state": "unknown",
        "toggle_state": "unknown",
        "killswitch_state": "unknown",
        "audit_state": "unknown",
        "read_state": "unknown",
        "audit": [],
        "error": None,
    }
    try:
        with _conn_ro() as conn:
            payload["enabled"] = _tri_from_config(conn, "LIVE_PARTIALS_ENABLED")
            payload["toggle_enabled"] = _tri_from_config(conn, "HUB_LIVE_PARTIALS_TOGGLE_ENABLED")
            payload["killswitch_enabled"] = _tri_from_config(conn, "EMERGENCY_KILLSWITCH")
            payload["audit"], payload["audit_state"] = _audit_rows(conn)
            payload["enabled_state"] = _state_of(payload["enabled"])
            payload["toggle_state"] = _state_of(payload["toggle_enabled"])
            payload["killswitch_state"] = _state_of(payload["killswitch_enabled"])
            payload["read_state"] = "ok"
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
