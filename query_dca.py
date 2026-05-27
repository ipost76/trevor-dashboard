#!/usr/bin/env python3
"""
query_dca.py — Hub READ-ONLY snapshot for /api/dca GET.

Returns:
    {
        "entries": [<row>, ...],
        "summary": {"total_active": N, "total_paused": N,
                    "daily_total": X, "monthly_estimate": X}
    }

Soft-error pattern: any failure prints a JSON shape with an `error` key
and exit 0 so the route renders gracefully.
"""
import json
import sys

sys.path.insert(0, "/home/trevor/trevor")

DB_PATH = "/home/trevor/trevor/trevor.db"
EMPTY_SUMMARY = {
    "total_active": 0,
    "total_paused": 0,
    "daily_total": 0.0,
    "monthly_estimate": 0.0,
}


def main() -> None:
    try:
        from dca_manager import DCAManager
        dm = DCAManager(DB_PATH)
        entries = dm.get_all() or []
        summary = dm.get_summary() or dict(EMPTY_SUMMARY)
        print(json.dumps({"entries": entries, "summary": summary}))
    except Exception as e:
        print(json.dumps({
            "entries": [],
            "summary": dict(EMPTY_SUMMARY),
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
