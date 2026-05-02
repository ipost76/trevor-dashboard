#!/usr/bin/env python3
"""
set_killswitch.py — Single Hub write surface for EMERGENCY_KILLSWITCH.
Per the Hub-Only Control Doctrine (BEHAVIOR_RULES.md Rule 32, rewritten
2026-05-02). Replaces the now-removed `!killswitch` Discord command path.

Usage (called by /api/killswitch POST via runPython with stdin):
    echo '{"action": "on"|"off", "reason": "..."}' | set_killswitch.py

Behavior — DELEGATES to `auto_trader.killswitch.set_killswitch()`:
    - One transactional UPDATE on the 4 EMERGENCY_KILLSWITCH* auto_config rows
    - Busts the in-process killswitch cache so the next is_killswitch_on()
      reads fresh (5s TTL bypassed)
    - Emits `[KILLSWITCH-ON]` / `[KILLSWITCH-OFF]` WARNING sentinel for
      Observatory monitors
    - Records audit metadata (last_toggle_iso / last_author='hub:<author>'
      / last_reason)

This wrapper is intentionally thin: it preserves the existing telemetry
surface (sentinel + audit metadata) instead of reimplementing raw SQL.

NOTE: Rule 1 (NO AUTO-CLOSE) and Rule 31 (auto trader never self-pauses)
still binding — flipping ON does NOT close any open position, cancel any
HL order, or restart any service. Only blocks NEW signal posts and new
AutoTrader entries.

Exit codes:
    0  success (toggled or idempotent no-op)
    1  usage error / bad action / bad JSON
    2  backend / DB error
"""
import json
import sys

# Bot lives at /home/trevor/trevor/; auto_trader is a package within it.
# python3 /path/to/this/script.py adds the SCRIPT's dir to sys.path[0], not
# cwd — so we add the bot dir explicitly. Mirrors query_auto_state.py.
sys.path.insert(0, "/home/trevor/trevor")


def _emit(payload: dict, code: int = 0) -> None:
    print(json.dumps(payload, default=str))
    sys.exit(code)


def main() -> None:
    raw = sys.stdin.read() if not sys.stdin.isatty() else (sys.argv[1] if len(sys.argv) > 1 else "")
    if not raw:
        _emit({"ok": False, "error": "missing JSON body on stdin"}, code=1)

    try:
        body = json.loads(raw)
    except json.JSONDecodeError as exc:
        _emit({"ok": False, "error": f"bad JSON: {exc}"}, code=1)

    action = str(body.get("action", "")).strip().lower()
    if action not in ("on", "off"):
        _emit({"ok": False, "error": f"action must be 'on' or 'off' (got {action!r})"}, code=1)

    raw_author = str(body.get("author", "ghost")).strip() or "ghost"
    author = f"hub:{raw_author}"
    reason = str(body.get("reason", "")).strip() or "Hub toggle"

    try:
        # Import inside main() so that even bad-JSON paths don't pay the
        # auto_trader import cost. cwd is set by runPython to /home/trevor/trevor.
        from auto_trader.killswitch import (
            get_state as _ks_state,
            set_killswitch as _ks_set,
        )

        prev = _ks_state()
        target = action == "on"

        if prev.enabled == target:
            _emit(
                {
                    "ok": True,
                    "no_change": True,
                    "action": action,
                    "EMERGENCY_KILLSWITCH": "true" if target else "false",
                    "prev_enabled": prev.enabled,
                    "prev_last_toggle": prev.last_toggle_iso,
                    "prev_last_author": prev.last_author,
                    "prev_last_reason": prev.last_reason,
                },
                code=0,
            )

        new_state = _ks_set(target, author=author, reason=reason)
        _emit(
            {
                "ok": True,
                "no_change": False,
                "action": action,
                "EMERGENCY_KILLSWITCH": "true" if new_state.enabled else "false",
                "new_state": {
                    "enabled": new_state.enabled,
                    "last_toggle": new_state.last_toggle_iso,
                    "last_author": new_state.last_author,
                    "last_reason": new_state.last_reason,
                },
                "prev_enabled": prev.enabled,
                "note": "cache busted in-process; bot pickup ≤5s via cached read in other processes",
            },
            code=0,
        )
    except SystemExit:
        raise
    except Exception as exc:
        _emit({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, code=2)


if __name__ == "__main__":
    main()
