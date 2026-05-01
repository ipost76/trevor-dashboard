#!/usr/bin/env python3
"""
Persist chat messages and bump the shared Anthropic budget pool.

Subcommands:
  user_message <session_id> <content>
    - Creates a new chat_sessions row when session_id == 0; returns the
      assigned session_id.
    - Otherwise appends a 'user' role row to chat_messages and updates
      last_active_at on the session.
    - JSON: { "ok": true, "session_id": <int>, "message_id": <int> }

  assistant_message <session_id> <content> <tokens_in> <tokens_out> <model>
    - Appends an 'assistant' role row, increments session totals, and
      atomically increments ANTHROPIC_API_DAILY_TOKENS_USED by
      (tokens_in + tokens_out).
    - JSON: { "ok": true, "message_id": <int>, "tokens_used_today": <int>,
              "budget_tokens": <int> }

All argv values cross as plain strings — NEVER interpolated into SQL.
Content is clipped to a hard ceiling (8KB user / 32KB assistant) before
INSERT to avoid runaway logs. Daily-reset is performed on every write so
the budget counter never carries yesterday's value into a new day.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import date
from typing import Optional

DB = "/home/trevor/trevor/trevor.db"
USER_MAX = 8 * 1024
ASSISTANT_MAX = 32 * 1024


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


def get_or_create_session(conn: sqlite3.Connection, session_id: int) -> int:
    if session_id and session_id > 0:
        row = conn.execute(
            "SELECT id FROM chat_sessions WHERE id=?", (session_id,)
        ).fetchone()
        if row:
            conn.execute(
                "UPDATE chat_sessions SET last_active_at=datetime('now') WHERE id=?",
                (session_id,),
            )
            return session_id
    cur = conn.execute(
        "INSERT INTO chat_sessions (created_at, last_active_at) "
        "VALUES (datetime('now'), datetime('now'))"
    )
    return int(cur.lastrowid)


def bump_budget(conn: sqlite3.Connection, delta: int) -> tuple[int, int]:
    """Returns (used_after, budget_cap)."""
    if delta < 0:
        delta = 0
    used = 0
    cap = 500_000
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
        cap = int(d.get("ANTHROPIC_API_DAILY_BUDGET_TOKENS", 500_000) or 500_000)
    except (TypeError, ValueError):
        cap = 500_000

    new_used = used + delta
    conn.execute(
        "INSERT INTO auto_config (key, value, updated_at) "
        "VALUES ('ANTHROPIC_API_DAILY_TOKENS_USED', ?, datetime('now')) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')",
        (str(new_used),),
    )
    return new_used, cap


def cmd_user_message(session_id: int, content: str) -> dict:
    with sqlite3.connect(DB, timeout=4.0) as conn:
        reset_daily_budget_if_needed(conn)
        sid = get_or_create_session(conn, session_id)
        cur = conn.execute(
            "INSERT INTO chat_messages (session_id, role, content) "
            "VALUES (?, 'user', ?)",
            (sid, content[:USER_MAX]),
        )
        conn.commit()
        return {"ok": True, "session_id": sid, "message_id": int(cur.lastrowid)}


def cmd_assistant_message(session_id: int, content: str,
                          tokens_in: int, tokens_out: int, model: str) -> dict:
    with sqlite3.connect(DB, timeout=4.0) as conn:
        reset_daily_budget_if_needed(conn)
        cur = conn.execute(
            "INSERT INTO chat_messages "
            "(session_id, role, content, tokens_in, tokens_out, model) "
            "VALUES (?, 'assistant', ?, ?, ?, ?)",
            (session_id, content[:ASSISTANT_MAX], tokens_in, tokens_out, model),
        )
        conn.execute(
            "UPDATE chat_sessions "
            "SET last_active_at=datetime('now'), "
            "    total_tokens_in  = total_tokens_in  + ?, "
            "    total_tokens_out = total_tokens_out + ? "
            "WHERE id=?",
            (tokens_in, tokens_out, session_id),
        )
        used_after, cap = bump_budget(conn, tokens_in + tokens_out)
        conn.commit()
        return {
            "ok": True,
            "message_id": int(cur.lastrowid),
            "tokens_used_today": used_after,
            "budget_tokens": cap,
        }


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: write_chat_log.py <subcommand> ..."}),
              file=sys.stderr)
        sys.exit(2)
    sub = sys.argv[1]
    try:
        if sub == "user_message":
            if len(sys.argv) < 4:
                raise ValueError("user_message requires <session_id> <content>")
            sid = int(sys.argv[2])
            content = sys.argv[3]
            print(json.dumps(cmd_user_message(sid, content)))
        elif sub == "assistant_message":
            if len(sys.argv) < 7:
                raise ValueError("assistant_message requires <session_id> <content> <tokens_in> <tokens_out> <model>")
            sid = int(sys.argv[2])
            content = sys.argv[3]
            t_in = int(sys.argv[4])
            t_out = int(sys.argv[5])
            model = sys.argv[6]
            print(json.dumps(cmd_assistant_message(sid, content, t_in, t_out, model)))
        else:
            print(json.dumps({"error": f"unknown subcommand '{sub}'"}), file=sys.stderr)
            sys.exit(2)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
