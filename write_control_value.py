#!/usr/bin/env python3
"""write_control_value.py — D2 (Control Center) PATCH backend.

Backs PATCH /api/auto/control-full/[key]. Argv:
    write_control_value.py <key> <value> <author> [reason]

Where <value> ∈ {"true", "false"} (case-insensitive, normalized to lower).
`reason` is optional; when present it lands in `change_log.notes` via
`audit_config_write` (Tier 1 toggles require it client-side per A1 §9).

Gate checks (in order):
    1. LIVE_EDIT_ENABLED must be 'true' → else exit 3 (HTTP 423)
    2. value must be 'true' or 'false' → else exit 1 (HTTP 400)
    3. key must be an existing boolean-valued row OR a known new toggle
       (we allow new rows so D2 can seed dormant toggles)
    4. key must NOT be in IMMUTABLE_KEYS

The 4 specific toggles that already have dedicated single-key write
surfaces (AUTO_TRADER_ENABLED, EMERGENCY_KILLSWITCH, LIVE_PARTIALS_ENABLED,
CONFIRM_CYCLES_PROMOTED — plus aggressive_mode_config.enabled via
/api/memory/aggressive) are EXPLICITLY blocked from this endpoint so the
existing audit trail (autotrader_state_audit + dedicated cache busts)
stays the single source of truth. Hub UI must route those to the
existing endpoints (which D2 already knows about).

Exit codes:
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

# B1b: bot dir on sys.path for audit_logger.
sys.path.insert(0, "/home/trevor/trevor")

DB = "/home/trevor/trevor/trevor.db"

# Booleans whose write surface is owned by a dedicated endpoint with its
# own audit + cache-bust. The generic D2 PATCH must NOT step on them.
DEDICATED_ENDPOINTS = {
    "AUTO_TRADER_ENABLED":      "/api/memory/autotrader-toggle (set_autotrader_enabled.py)",
    "EMERGENCY_KILLSWITCH":     "/api/killswitch (set_killswitch.py — cache bust required)",
    "LIVE_PARTIALS_ENABLED":    "/api/auto/partials-toggle (set_live_partials_enabled.py)",
    "CONFIRM_CYCLES_PROMOTED":  "/api/auto/exit-controls (set_confirm_cycles_promoted.py)",
}

# Booleans Ghost should never flip from the generic toggle UI even when
# LIVE_EDIT_ENABLED=true. Add here if a future case demands it.
IMMUTABLE_KEYS: dict[str, str] = {
    # None today. Killswitch is in DEDICATED_ENDPOINTS, not immutable.
}


def _emit(payload: dict, code: int = 0) -> None:
    print(json.dumps(payload, default=str))
    sys.exit(code)


def main() -> None:
    if len(sys.argv) < 3:
        _emit({"ok": False, "error": "Usage: write_control_value.py <key> <value> [author]", "status": 400}, code=1)

    key = (sys.argv[1] or "").strip()
    raw_value = sys.argv[2] if len(sys.argv) > 2 else ""
    author = (sys.argv[3] if len(sys.argv) > 3 else "").strip() or "ghost"
    reason = (sys.argv[4] if len(sys.argv) > 4 else "").strip()

    if not key:
        _emit({"ok": False, "error": "key may not be empty", "status": 400}, code=1)

    normalized = raw_value.strip().lower()
    if normalized not in ("true", "false"):
        _emit({
            "ok": False,
            "error": f"value must be 'true' or 'false' (got {raw_value!r})",
            "status": 400,
        }, code=1)

    if key in IMMUTABLE_KEYS:
        _emit({
            "ok": False,
            "error": f"{key} is immutable: {IMMUTABLE_KEYS[key]}",
            "status": 400,
        }, code=1)

    if key in DEDICATED_ENDPOINTS:
        _emit({
            "ok": False,
            "error": f"{key} has a dedicated endpoint: {DEDICATED_ENDPOINTS[key]}",
            "status": 400,
        }, code=1)

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

        # 2. Read current value (idempotency check + type guard)
        existing = conn.execute(
            "SELECT value FROM auto_config WHERE key=?", (key,)
        ).fetchone()
        prev_value: Optional[str] = existing["value"] if existing is not None else None

        # If the row exists and is NOT a boolean shape, refuse — caller is
        # mis-routing a numeric/string config through the toggle endpoint.
        if prev_value is not None and prev_value.strip().lower() not in ("true", "false"):
            _emit({
                "ok": False,
                "error": f"{key} is not a boolean config — use /api/auto/config-full/{key} instead",
                "status": 400,
            }, code=1)

        if prev_value is not None and prev_value.strip().lower() == normalized:
            _emit({
                "ok": True, "no_change": True,
                "key": key, "value": normalized,
                "status": 200,
            }, code=0)

        # 3. Audit BEFORE write — same B1b convention.
        try:
            from audit_logger import audit_config_write
            audit_config_write(
                key=key,
                new_value=normalized,
                actor="ghost_hub",
                source_type="UI",
                session_id=f"hub:{author}",
                prompt_id=None,
                notes=reason or "D2 toggle flip",
            )
        except Exception:
            pass

        # 4. Write
        conn.execute(
            "INSERT INTO auto_config (key, value, updated_at) "
            "VALUES (?, ?, datetime('now')) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, "
            "updated_at=datetime('now')",
            (key, normalized),
        )
        conn.commit()

        row = conn.execute(
            "SELECT value, updated_at FROM auto_config WHERE key=?", (key,)
        ).fetchone()
        _emit({
            "ok": True, "no_change": False,
            "key": key,
            "prev_value": prev_value,
            "value": row["value"] if row else normalized,
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
    main()
