#!/usr/bin/env python3
"""
Read shared Anthropic budget state — same auto_config ledger as F2's
journal flow.

Mirrors F2's reset semantics: if ANTHROPIC_API_DAILY_RESET_DATE is not
today, zero ANTHROPIC_API_DAILY_TOKENS_USED and stamp the new date
before reporting. This guarantees Hub UI never displays stale yesterday
counts on the first read of a new day.

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
from datetime import date

DB = "/home/trevor/trevor/trevor.db"
DEFAULT_BUDGET = 500_000
HEADROOM_TOKENS = 1500


def reset_daily_budget_if_needed(conn: sqlite3.Connection) -> None:
    today = date.today().isoformat()
    row = conn.execute(
        "SELECT value FROM auto_config WHERE key='ANTHROPIC_API_DAILY_RESET_DATE'"
    ).fetchone()
    if row and row[0] != today:
        conn.execute(
            "UPDATE auto_config SET value='0', updated_at=datetime('now') "
            "WHERE key='ANTHROPIC_API_DAILY_TOKENS_USED'"
        )
        conn.execute(
            "UPDATE auto_config SET value=?, updated_at=datetime('now') "
            "WHERE key='ANTHROPIC_API_DAILY_RESET_DATE'",
            (today,),
        )
        conn.commit()
    elif not row:
        # Initialize the key if it's never been set.
        conn.execute(
            "INSERT INTO auto_config (key, value, updated_at) "
            "VALUES ('ANTHROPIC_API_DAILY_RESET_DATE', ?, datetime('now')) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')",
            (today,),
        )
        conn.commit()


def main() -> None:
    used = 0
    budget = DEFAULT_BUDGET
    try:
        conn = sqlite3.connect(DB, timeout=2.0)
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
        reset_daily_budget_if_needed(conn)
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
