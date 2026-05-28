#!/usr/bin/env python3
"""write_config_value.py — D1 (Config editor) PATCH backend.

Backs PATCH /api/auto/config-full/[key]. Argv:
    write_config_value.py <key> <value> <author>

Gate checks (in order):
    1. LIVE_EDIT_ENABLED must be 'true' → else exit 3 (HTTP 423)
    2. key must not be in IMMUTABLE_KEYS → else exit 1 (HTTP 400)
    3. key must not be a boolean-valued config (those live in
       write_control_value.py) → else exit 1 (HTTP 400)
    4. key must exist OR be one of the known DEFAULTS — defensive guard
       against typos creating ghost rows. Not enforced in this version;
       writes will INSERT OR REPLACE.

Exit codes (consumed by the Next.js route to map HTTP status):
    0  success — JSON: {ok, key, value, updated_at}
    1  bad input — JSON: {ok:false, error, status:400}
    2  internal/DB error — JSON: {ok:false, error, status:500}
    3  gate locked — JSON: {ok:false, gate_locked:true, error, status:423}
"""
from __future__ import annotations

import json
import sqlite3
import sys
from typing import Optional

# B1b: bot dir on sys.path for audit_logger (lives at
# /home/trevor/trevor/audit_logger.py). Mirrors set_killswitch.py:38.
sys.path.insert(0, "/home/trevor/trevor")

DB = "/home/trevor/trevor/trevor.db"

IMMUTABLE_KEYS = {
    "LIVE_HARD_CAPITAL_CAP_USD",
    "EMERGENCY_KILLSWITCH_LAST_TOGGLE",
    "EMERGENCY_KILLSWITCH_LAST_AUTHOR",
    "EMERGENCY_KILLSWITCH_LAST_REASON",
    "ANTHROPIC_API_DAILY_RESET_DATE",
    "ANTHROPIC_API_DAILY_TOKENS_USED",
    # DISCOVERED_TICKERS removed 2026-05-28 (DEGEN-REMOVE)
}


def _emit(payload: dict, code: int = 0) -> None:
    print(json.dumps(payload, default=str))
    sys.exit(code)


def _is_bool_value(value: Optional[str]) -> bool:
    return value is not None and value.strip().lower() in ("true", "false")


def main() -> None:
    if len(sys.argv) < 3:
        _emit({"ok": False, "error": "Usage: write_config_value.py <key> <value> [author]", "status": 400}, code=1)

    key = (sys.argv[1] or "").strip()
    new_value = sys.argv[2] if len(sys.argv) > 2 else ""
    author = (sys.argv[3] if len(sys.argv) > 3 else "").strip() or "ghost"

    if not key:
        _emit({"ok": False, "error": "key may not be empty", "status": 400}, code=1)

    if key in IMMUTABLE_KEYS:
        _emit({"ok": False, "error": f"{key} is immutable", "status": 400}, code=1)

    try:
        conn = sqlite3.connect(DB, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
    except Exception as exc:
        _emit({"ok": False, "error": f"db open: {type(exc).__name__}: {exc}", "status": 500}, code=2)

    try:
        # 1. Gate check
        flag_row = conn.execute(
            "SELECT value FROM auto_config WHERE key='LIVE_EDIT_ENABLED'"
        ).fetchone()
        gate_on = bool(flag_row) and (
            (flag_row["value"] or "false").strip().lower() == "true"
        )
        if not gate_on:
            _emit({
                "ok": False, "gate_locked": True,
                "error": "LIVE_EDIT_ENABLED is false",
                "status": 423,
            }, code=3)

        # 2. Refuse boolean-valued config writes here (they go through
        #    write_control_value.py so the audit trail records source_type
        #    correctly and the type discipline stays clean).
        existing = conn.execute(
            "SELECT value FROM auto_config WHERE key=?", (key,)
        ).fetchone()
        if existing is not None and _is_bool_value(existing["value"]):
            _emit({
                "ok": False,
                "error": f"{key} is a boolean toggle — use /api/auto/control-full/{key} instead",
                "status": 400,
            }, code=1)
        # Catch typos that would write a literal "true"/"false" string into
        # what should be a numeric config — same toggle-path argument.
        if _is_bool_value(new_value):
            _emit({
                "ok": False,
                "error": "boolean-shaped value — use /api/auto/control-full/[key] for toggles",
                "status": 400,
            }, code=1)

        prev_value = existing["value"] if existing is not None else None

        # 3. Idempotent no-op (same value as current)
        if prev_value is not None and str(prev_value) == str(new_value):
            _emit({
                "ok": True, "no_change": True,
                "key": key, "value": prev_value,
                "updated_at": None,
                "status": 200,
            }, code=0)

        # 4. Audit BEFORE write (matches B1b convention so the change_log
        #    captures the actual transition even if the INSERT fails).
        try:
            from audit_logger import audit_config_write
            audit_config_write(
                key=key,
                new_value=str(new_value),
                actor="ghost_hub",
                source_type="UI",
                session_id=f"hub:{author}",
                prompt_id=None,
                notes=f"D1 config edit",
            )
        except Exception:
            # FAIL-OPEN — audit failure must not block the write.
            pass

        # 5. Write
        conn.execute(
            "INSERT INTO auto_config (key, value, updated_at) "
            "VALUES (?, ?, datetime('now')) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, "
            "updated_at=datetime('now')",
            (key, new_value),
        )
        conn.commit()

        row = conn.execute(
            "SELECT value, updated_at FROM auto_config WHERE key=?", (key,)
        ).fetchone()
        _emit({
            "ok": True, "no_change": False,
            "key": key,
            "prev_value": prev_value,
            "value": row["value"] if row else new_value,
            "updated_at": row["updated_at"] if row else None,
            "status": 200,
        }, code=0)
    except SystemExit:
        raise
    except Exception as exc:
        _emit({"ok": False, "error": f"{type(exc).__name__}: {exc}", "status": 500}, code=2)
    finally:
        try:
            conn.close()
        except Exception:
            pass


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
