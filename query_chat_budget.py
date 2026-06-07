#!/usr/bin/env python3
"""
Read shared Anthropic budget state — same auto_config ledger as F2's
journal flow.

W-C-P2b: PURE READ — opens the DB read-only and never writes. The daily
counter reset is owned VM-side (write_chat_log.py / the bot) and reaches
the Hub's replica via litestream, so this Hub-side read must never attempt
the rollover UPDATE (it would hit the read-only replica and fail).

JSON output:
{
  "used_tokens":     int,
  "budget_tokens":   int,
  "available_tokens":int,
  "pct_used":        float,
  "blocked":         bool,
  "reset_at_local_midnight": true
}

Block threshold: < 1500 tokens of headroom (one round-trip with the
streaming endpoint's 800-out + ~700-in budget). Below that we hard-stop
to avoid mid-stream budget exhaustion.
"""
from __future__ import annotations

import json
import sqlite3
import sys

DB = "/home/trevor/trevor/trevor.db"
DEFAULT_BUDGET = 500_000
HEADROOM_TOKENS = 1500


def main() -> None:
    used = 0
    budget = DEFAULT_BUDGET
    try:
        # W-C-P2b: read-only URI — guarantees this never writes the replica.
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10)
    except sqlite3.OperationalError as exc:
        print(json.dumps({
            "used_tokens": 0,
            "budget_tokens": DEFAULT_BUDGET,
            "available_tokens": DEFAULT_BUDGET,
            "pct_used": 0,
            "blocked": False,
            "reset_at_local_midnight": True,
            "error": f"db open failed: {exc}",
        }))
        return

    try:
        rows = conn.execute(
            "SELECT key, value FROM auto_config WHERE key IN ("
            "'ANTHROPIC_API_DAILY_TOKENS_USED','ANTHROPIC_API_DAILY_BUDGET_TOKENS')"
        ).fetchall()
        d = dict(rows)
        try:
            used = int(d.get("ANTHROPIC_API_DAILY_TOKENS_USED", 0) or 0)
        except (TypeError, ValueError):
            used = 0
        try:
            budget = max(0, int(d.get("ANTHROPIC_API_DAILY_BUDGET_TOKENS", DEFAULT_BUDGET)
                                or DEFAULT_BUDGET))
        except (TypeError, ValueError):
            budget = DEFAULT_BUDGET
    finally:
        conn.close()

    available = max(0, budget - used)
    pct = (used / budget * 100.0) if budget > 0 else 100.0
    blocked = available < HEADROOM_TOKENS

    print(json.dumps({
        "used_tokens": used,
        "budget_tokens": budget,
        "available_tokens": available,
        "pct_used": round(pct, 1),
        "blocked": blocked,
        "reset_at_local_midnight": True,
    }))


if __name__ == "__main__":
    # OUTER-WRAP: 2026-05-27 (silent-crash visibility)
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        try:
            main()
        except Exception as exc:  # noqa: BLE001
            print(json.dumps({
                "used_tokens": 0,
                "budget_tokens": DEFAULT_BUDGET,
                "available_tokens": DEFAULT_BUDGET,
                "pct_used": 0,
                "blocked": False,
                "reset_at_local_midnight": True,
                "error": f"{type(exc).__name__}: {exc}",
            }))
            sys.exit(0)

    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
