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
    "enabled": bool | null,             # AUTO_TRADER_ENABLED   (null = UNKNOWN)
    "toggle_enabled": bool | null,      # HUB_AUTOTRADER_TOGGLE_ENABLED gate
    "killswitch_enabled": bool | null,  # EMERGENCY_KILLSWITCH (informational)
    "enabled_state" / "toggle_state" / "killswitch_state":
        "on" | "off" | "unknown",       # the discriminators
    "audit_state": "ok" | "table_absent" | "unknown",
    "read_state": "ok" | "unknown",
    "audit": [ { id, action, prev_value, new_value, source, timestamp } x ≤5 ]
  }

🚨 B1-MONEY-PATH-HONESTY (2026-08-04) — THREE STATES, NOT TWO.
Every field above is EXPRESSIBLE as unknown, and every failure path resolves
to it: an absent row, a NULL value, an unreadable database, any exception.

🚨 WHY. This file used to seed `{"enabled": True}` — auto_trader/config.py's
CONSUMER default — and then, on any exception, attach an `error` string and
print the seed unchanged. So a database it could not open at all was reported
as **AutoTrader ON**, and an absent row was reported the same way, both
pixel-identical to a real reading. `killswitch_enabled` had the mirror-image
bug seeded at False: an unreadable store rendered the emergency stop as
DISENGAGED. That is precisely the defect QUAL-01 closed in /api/system-health
(which returns `{"active": null, "status": "unknown"}`) and it survived here.

A consumer default is a fine default FOR THE CONSUMER. It is not a reading,
and this file's job is to report readings.

🚨 `enabled`, `toggle_enabled`, `killswitch_enabled`, `audit` and `error` are
all KEPT, present and populated — nothing was renamed or removed. `error` in
particular stays exactly where it was: a downstream `!data || data.error`
branch must keep firing.
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

    B1: replaces `_bool_from_config(conn, key, default)`. That helper resolved
    an absent row to a caller-supplied default and returned it as if it were a
    reading, so absence and a real value were indistinguishable downstream.
    Only a row we ACTUALLY READ may move this off None."""
    row = conn.execute(
        "SELECT value FROM auto_config WHERE key=?", (key,),
    ).fetchone()
    if not row or row["value"] is None:
        return None
    return str(row["value"]).strip().lower() == "true"


def _state_of(v) -> str:
    """The discriminator beside every tri-state field."""
    return "unknown" if v is None else ("on" if v else "off")


def _audit_rows(conn: sqlite3.Connection):
    """(rows, state). Table is created lazily by set_autotrader_enabled on
    first write. B1: an absent table now says so — `[]` alone was
    indistinguishable from 'no toggle has ever happened'."""
    try:
        rows = conn.execute(
            "SELECT id, action, prev_value, new_value, source, timestamp "
            "FROM autotrader_state_audit "
            "ORDER BY id DESC LIMIT 5"
        ).fetchall()
        return [dict(r) for r in rows], "ok"
    except sqlite3.OperationalError:
        return [], "table_absent"


def main() -> None:
    # 🚨 THE UNKNOWN DEFAULT. Nothing below may set these to a confident
    # reading unless it has actually READ a row saying so.
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
            payload["enabled"] = _tri_from_config(conn, "AUTO_TRADER_ENABLED")
            payload["toggle_enabled"] = _tri_from_config(conn, "HUB_AUTOTRADER_TOGGLE_ENABLED")
            payload["killswitch_enabled"] = _tri_from_config(conn, "EMERGENCY_KILLSWITCH")
            payload["audit"], payload["audit_state"] = _audit_rows(conn)
            payload["enabled_state"] = _state_of(payload["enabled"])
            payload["toggle_state"] = _state_of(payload["toggle_enabled"])
            payload["killswitch_state"] = _state_of(payload["killswitch_enabled"])
            payload["read_state"] = "ok"
    except Exception as e:
        # Fail-soft is PRESERVED — the route must never 500. Only the value it
        # fails soft TO has changed: unknown, not a confident all-clear.
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
