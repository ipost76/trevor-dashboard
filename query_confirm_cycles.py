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


def _tri_from_config(conn: sqlite3.Connection, key: str):
    """True / False / **None**, and None is the unknown value — never False.

    🚨 B1-MONEY-PATH-HONESTY (2026-08-04): replaces `_bool_from_config(conn,
    key, default)`, which returned a caller-supplied default for an absent row
    as if it were a reading. Only a row we ACTUALLY READ moves this off None."""
    row = conn.execute(
        "SELECT value FROM auto_config WHERE key=?", (key,),
    ).fetchone()
    if not row or row["value"] is None:
        return None
    return str(row["value"]).strip().lower() == "true"


def _int_or_none(conn: sqlite3.Connection, key: str):
    """int or **None**. 🚨 A GATE MUST NEVER FABRICATE A NUMBER — the same rule
    `query_profit_risk._breaker_gauge` follows for the breakers. An absent row,
    a NULL, or an unparseable value is UNKNOWN. It is NOT `0`, and it is NOT
    the config default dressed as a measurement: `MOMENTUM_EXIT_CONFIRM_CYCLES`
    absent used to surface as the hardcoded `default=2`, pixel-identical to a
    real reading of 2."""
    row = conn.execute(
        "SELECT value FROM auto_config WHERE key=?", (key,),
    ).fetchone()
    if not row or row["value"] is None:
        return None
    try:
        return int(float(row["value"]))
    except (ValueError, TypeError):
        return None


def _state_of(v) -> str:
    """The discriminator beside every tri-state field."""
    return "unknown" if v is None else ("on" if v else "off")


def _audit_rows(conn: sqlite3.Connection):  # -> (rows, state) since B1
    """Last 5 confirm_cycles_* audit rows. Table may not exist on a fresh DB
    before the first toggle write. B1: an absent table now SAYS so — `[]` alone
    was indistinguishable from 'no toggle has ever happened'."""
    try:
        rows = conn.execute(
            "SELECT id, action, prev_value, new_value, source, timestamp "
            "FROM autotrader_state_audit "
            "WHERE action IN ('confirm_cycles_on', 'confirm_cycles_off') "
            "ORDER BY id DESC LIMIT 5"
        ).fetchall()
        return [dict(r) for r in rows], "ok"
    except sqlite3.OperationalError:
        return [], "table_absent"


def main() -> None:
    # 🚨 B1: THE UNKNOWN DEFAULT. Nothing below may set these to a confident
    # reading unless it has actually READ a row saying so. Fail-soft is
    # preserved; only the value it fails soft TO has changed. Every field is
    # kept present and populated, `error` included.
    payload: dict = {
        "promoted": None,
        "confirm_cycles": None,
        "toggle_enabled": None,
        "shadow_enabled": None,
        "promoted_state": "unknown",
        "toggle_state": "unknown",
        "shadow_state": "unknown",
        "audit_state": "unknown",
        "read_state": "unknown",
        "audit": [],
        "error": None,
    }
    try:
        with _conn_ro() as conn:
            payload["promoted"] = _tri_from_config(conn, "CONFIRM_CYCLES_PROMOTED")
            payload["confirm_cycles"] = _int_or_none(conn, "MOMENTUM_EXIT_CONFIRM_CYCLES")
            payload["toggle_enabled"] = _tri_from_config(conn, "HUB_CONFIRM_CYCLES_TOGGLE_ENABLED")
            payload["shadow_enabled"] = _tri_from_config(conn, "MOMENTUM_EXIT_CONFIRM_SHADOW")
            payload["audit"], payload["audit_state"] = _audit_rows(conn)
            payload["promoted_state"] = _state_of(payload["promoted"])
            payload["toggle_state"] = _state_of(payload["toggle_enabled"])
            payload["shadow_state"] = _state_of(payload["shadow_enabled"])
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
