#!/usr/bin/env python3
"""
query_reminders.py — Hub READ-ONLY snapshot for /api/reminders GET.

Returns:
    {
        "reminders": [<row>, ...],
        "summary":   {"pending": N, "active": N, "completed": N, "cancelled": N}
    }

Soft-error pattern: any failure prints a JSON shape with an `error` key
and exit 0 so the route renders gracefully.
"""
import json
import sys

sys.path.insert(0, "/home/trevor/trevor")

DB_PATH = "/home/trevor/trevor/trevor.db"
STATUS_KEYS = ("pending", "active", "completed", "cancelled")


def main() -> None:
    try:
        from reminder_manager import ReminderManager
        rm = ReminderManager(DB_PATH)
        all_r = rm.get_all_reminders(include_completed=True)
        summary = {k: 0 for k in STATUS_KEYS}
        for r in all_r:
            s = r.get("status")
            if s in summary:
                summary[s] += 1
        print(json.dumps({"reminders": all_r, "summary": summary}))
    except Exception as e:
        print(json.dumps({
            "reminders": [],
            "summary": {k: 0 for k in STATUS_KEYS},
            "error": str(e),
        }))
        sys.exit(0)


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
