#!/usr/bin/env python3
"""
set_reminders.py — Hub WRITE dispatcher for /api/reminders POST.

Usage:
    set_reminders.py <action>   (JSON body via stdin)

Actions:
    add       — body: {text, due_at, repeat_mode?, source?}     → {ok, id}
    complete  — body: {id}                                       → {ok}
    cancel    — body: {id}                                       → {ok}
    edit      — body: {id, text?, due_at?, repeat_mode?}         → {ok}

Exit codes:
    0  success
    1  usage / unknown action
    2  DB / unexpected error
    4  invalid input (bad JSON / missing required fields / bad enum)
"""
import json
import sys

sys.path.insert(0, "/home/trevor/trevor")

DB_PATH = "/home/trevor/trevor/trevor.db"
VALID_REPEAT_MODES = ("once", "twice", "until_confirmed")
VALID_ACTIONS = ("add", "complete", "cancel", "edit")


def _emit(payload: dict, code: int = 0) -> None:
    print(json.dumps(payload))
    sys.exit(code)


def _read_int(body: dict, key: str = "id") -> int:
    raw = body.get(key)
    if raw is None or raw == "":
        _emit({"ok": False, "error": f"missing required field: {key}"}, code=4)
    try:
        return int(raw)
    except (TypeError, ValueError):
        _emit({"ok": False, "error": f"{key} must be an integer"}, code=4)
    return 0  # unreachable, satisfies type checker


def main() -> None:
    if len(sys.argv) < 2:
        _emit({"ok": False, "error": "Usage: set_reminders.py <action>"}, code=1)

    action = sys.argv[1].strip().lower()
    if action not in VALID_ACTIONS:
        _emit({"ok": False, "error": f"unknown action: {action}"}, code=1)

    raw_body = sys.stdin.read().strip() or "{}"
    try:
        body = json.loads(raw_body)
    except Exception as e:
        _emit({"ok": False, "error": f"invalid JSON body: {e}"}, code=4)

    if not isinstance(body, dict):
        _emit({"ok": False, "error": "body must be a JSON object"}, code=4)

    try:
        from reminder_manager import ReminderManager
        rm = ReminderManager(DB_PATH)

        if action == "add":
            text = (body.get("text") or "").strip()
            due_at = (body.get("due_at") or "").strip()
            repeat_mode = (body.get("repeat_mode") or "once").strip()
            source = (body.get("source") or "hub").strip()
            if not text:
                _emit({"ok": False, "error": "text required"}, code=4)
            if not due_at:
                _emit({"ok": False, "error": "due_at required"}, code=4)
            if repeat_mode not in VALID_REPEAT_MODES:
                _emit({"ok": False, "error": f"invalid repeat_mode: {repeat_mode}"}, code=4)
            rid = rm.add_reminder(text, due_at, repeat_mode, source)
            _emit({"ok": True, "id": int(rid)}, code=0)

        elif action == "complete":
            rid = _read_int(body)
            rm.complete_reminder(rid)
            _emit({"ok": True, "id": rid}, code=0)

        elif action == "cancel":
            rid = _read_int(body)
            rm.cancel_reminder(rid)
            _emit({"ok": True, "id": rid}, code=0)

        elif action == "edit":
            rid = _read_int(body)
            kwargs = {}
            if "text" in body and body["text"]:
                kwargs["text"] = str(body["text"]).strip()
            if "due_at" in body and body["due_at"]:
                kwargs["due_at"] = str(body["due_at"]).strip()
            if "repeat_mode" in body and body["repeat_mode"]:
                rm_val = str(body["repeat_mode"]).strip()
                if rm_val not in VALID_REPEAT_MODES:
                    _emit({"ok": False, "error": f"invalid repeat_mode: {rm_val}"}, code=4)
                kwargs["repeat_mode"] = rm_val
            if not kwargs:
                _emit({"ok": False, "error": "no fields to edit"}, code=4)
            rm.edit_reminder(rid, **kwargs)
            _emit({"ok": True, "id": rid}, code=0)

    except SystemExit:
        raise
    except Exception as e:
        _emit({"ok": False, "error": str(e)}, code=2)


if __name__ == "__main__":
    main()
