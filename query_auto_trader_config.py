#!/usr/bin/env python3
"""
Hub helper for /api/auto-trader/config (P1 overhaul, 2026-04-23).

GET  scope=get            -> reads all auto_config rows (read-only)
POST scope=set key value  -> whitelisted single-key write

Only the keys in ALLOWED_WRITE_KEYS may be written from the Hub. Any other
key returns an error without touching the DB. Writer uses INSERT OR REPLACE
with parametrized values — no shell, no string interpolation. Input is
passed via argv (spawnSync argv array in Node), so user input never reaches
a shell.

The trevor.db READ-ONLY invariant for the Hub is carved out for auto_config
ONLY. No other table is touched by this helper.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys

DB_PATH = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")

# Keys the Hub is allowed to write. Everything else is rejected.
# Value type is used for validation only; DB stores TEXT.
# 2026-04-26: LIVE_* family added so the Hub Configuration panel can edit
# real-money trading parameters. LIVE_HARD_CAPITAL_CAP_USD intentionally
# stays view-only (code-enforced floor; never written from the Hub).
# LIVE_ORDER_TYPE is also view-only (string enum; would need a select UI).
ALLOWED_WRITE_KEYS: dict[str, str] = {
    # Paper / generic
    "AUTO_TRADER_ENABLED": "bool",
    "AGGRESSIVE_THRESHOLD": "int",
    "TICKER_DISCOVERY": "bool",
    "PER_TRADE_USD": "float",
    "LEVERAGE_DEFAULT": "float",
    # Live
    "AUTO_LIVE_ENABLED": "bool",
    "LIVE_PER_TRADE_USD": "float",
    "LIVE_LEVERAGE_DEFAULT": "float",
    "LIVE_SLIPPAGE_PCT": "float",
}
# 2026-04-27 Aggressive Mode Sweep: removed MAX_CONCURRENT / MAX_TRADES_PER_DAY
# / CAPITAL_USD / LIVE_MAX_CONCURRENT / LIVE_MAX_DAILY_TRADES / LIVE_CAPITAL_USD
# / LIVE_DEAD_MAN_SWITCH_MS / LIVE_SDK_ERROR_THRESHOLD. Auto trader fires on
# every qualifying signal — only execution gate is confidence vs per-ticker
# threshold. Dead-man switch + hard capital cap remain code-enforced.
# 2026-04-25: MAX_CONSECUTIVE_LOSSES + PAUSE_AFTER_LOSSES_MINUTES removed
# (Gate 4 deleted; auto trader no longer self-pauses).


def _coerce(value: str, kind: str) -> tuple[bool, str, str]:
    """Validate + normalize a raw string value. Returns (ok, canonical, err)."""
    v = (value or "").strip()
    if kind == "bool":
        low = v.lower()
        if low in ("true", "1", "yes", "on"):
            return True, "true", ""
        if low in ("false", "0", "no", "off", ""):
            return True, "false", ""
        return False, "", f"invalid bool: {value!r}"
    if kind == "int":
        try:
            n = int(float(v))  # tolerate "35.0"
            if n < 0:
                return False, "", "must be >= 0"
            return True, str(n), ""
        except (TypeError, ValueError):
            return False, "", f"invalid int: {value!r}"
    if kind == "float":
        try:
            f = float(v)
            if f < 0:
                return False, "", "must be >= 0"
            return True, f"{f:g}", ""  # strip trailing zeros
        except (TypeError, ValueError):
            return False, "", f"invalid float: {value!r}"
    return False, "", f"unknown kind: {kind}"


def get_all() -> dict:
    try:
        conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=5.0)
        try:
            rows = conn.execute(
                "SELECT key, value FROM auto_config"
            ).fetchall()
        finally:
            conn.close()
        return {
            "ok": True,
            "config": {k: v for k, v in rows},
            "allowed_write_keys": list(ALLOWED_WRITE_KEYS.keys()),
        }
    except Exception as e:
        return {
            "ok": False, "config": {},
            "allowed_write_keys": list(ALLOWED_WRITE_KEYS.keys()),
            "error": str(e),
        }


def set_one(key: str, value: str) -> dict:
    if key not in ALLOWED_WRITE_KEYS:
        return {"ok": False, "error": f"key not allowed: {key}"}
    ok, canonical, err = _coerce(value, ALLOWED_WRITE_KEYS[key])
    if not ok:
        return {"ok": False, "error": f"validation failed for {key}: {err}"}
    try:
        conn = sqlite3.connect(DB_PATH, timeout=5.0)
        try:
            conn.execute("PRAGMA busy_timeout = 3000")
            conn.execute(
                "INSERT INTO auto_config (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, canonical),
            )
            conn.commit()
        finally:
            conn.close()
        return {"ok": True, "key": key, "value": canonical}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def main() -> int:
    scope = sys.argv[1] if len(sys.argv) > 1 else "get"
    if scope == "get":
        sys.stdout.write(json.dumps(get_all(), default=str))
        return 0
    if scope == "set":
        if len(sys.argv) < 4:
            sys.stdout.write(json.dumps(
                {"ok": False, "error": "usage: set <key> <value>"}))
            return 1
        key = sys.argv[2]
        value = sys.argv[3]
        result = set_one(key, value)
        sys.stdout.write(json.dumps(result, default=str))
        return 0 if result.get("ok") else 1
    sys.stdout.write(json.dumps({"ok": False, "error": f"unknown scope: {scope}"}))
    return 1


if __name__ == "__main__":
    sys.exit(main())
