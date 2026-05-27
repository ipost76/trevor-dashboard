#!/usr/bin/env python3
"""
query_aggressive.py — Read-only Aggressive Mode status for /api/memory/aggressive GET.

Returns the live state of the aggressive_mode_config singleton plus the
HUB_AGGRESSIVE_TOGGLE_ENABLED flag (controls whether the Hub UI can write a
toggle), EMERGENCY_KILLSWITCH (informational; toggling aggressive does NOT
disable the killswitch), and the last 5 audit rows from aggressive_mode_history.

NOT a write path — see set_aggressive.py.

Output JSON shape:
  {
    "enabled": bool,
    "threshold_delta": int,
    "enabled_at": str | null,
    "revert_at": str | null,
    "enabled_by": str | null,
    "reason": str | null,
    "total_signals_fired": int,
    "minutes_until_revert": int | null,
    "toggle_enabled": bool,           # HUB_AGGRESSIVE_TOGGLE_ENABLED
    "killswitch_enabled": bool,       # EMERGENCY_KILLSWITCH (informational)
    "audit": [ { event_type, threshold_delta, duration_hours,
                 actor, reason, signals_fired, timestamp } x ≤5 ]
  }
"""
import json
import sqlite3
from datetime import datetime, timezone

DB_PATH = "/home/trevor/trevor/trevor.db"
DB_RO_URI = f"file:{DB_PATH}?mode=ro"


def _conn_ro() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_RO_URI, uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def _bool_from_config(conn: sqlite3.Connection, key: str) -> bool:
    row = conn.execute(
        "SELECT value FROM auto_config WHERE key=?", (key,),
    ).fetchone()
    return bool(row) and (row["value"] or "false").strip().lower() == "true"


def _minutes_until_revert(revert_at: str | None) -> int | None:
    if not revert_at:
        return None
    try:
        dt = datetime.fromisoformat(revert_at)
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta_sec = (dt - datetime.now(timezone.utc)).total_seconds()
    return max(0, round(delta_sec / 60.0))


def main() -> None:
    payload: dict = {
        "enabled": False,
        "threshold_delta": 0,
        "enabled_at": None,
        "revert_at": None,
        "enabled_by": None,
        "reason": None,
        "total_signals_fired": 0,
        "minutes_until_revert": None,
        "toggle_enabled": False,
        "killswitch_enabled": False,
        "audit": [],
    }

    try:
        with _conn_ro() as conn:
            cfg = conn.execute(
                "SELECT enabled, threshold_delta, enabled_at, revert_at, "
                "enabled_by, reason, total_signals_fired "
                "FROM aggressive_mode_config WHERE id=1"
            ).fetchone()
            if cfg:
                payload["enabled"] = bool(cfg["enabled"])
                payload["threshold_delta"] = int(cfg["threshold_delta"] or 0)
                payload["enabled_at"] = cfg["enabled_at"]
                payload["revert_at"] = cfg["revert_at"]
                payload["enabled_by"] = cfg["enabled_by"]
                payload["reason"] = cfg["reason"]
                payload["total_signals_fired"] = int(cfg["total_signals_fired"] or 0)
                payload["minutes_until_revert"] = _minutes_until_revert(cfg["revert_at"])

            payload["toggle_enabled"] = _bool_from_config(
                conn, "HUB_AGGRESSIVE_TOGGLE_ENABLED",
            )
            payload["killswitch_enabled"] = _bool_from_config(
                conn, "EMERGENCY_KILLSWITCH",
            )

            audit_rows = conn.execute(
                "SELECT id, event_type, threshold_delta, duration_hours, "
                "actor, reason, signals_fired, timestamp "
                "FROM aggressive_mode_history "
                "ORDER BY id DESC LIMIT 5"
            ).fetchall()
            payload["audit"] = [dict(r) for r in audit_rows]
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
