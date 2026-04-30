#!/usr/bin/env python3
"""
Generate (or fetch) a per-trade narrative using Anthropic Haiku.

Usage:
  query_journal_narrative.py <trade_source> <trade_id> [--force]

Modes:
  - Default: if a narrative for this (source, id) already exists, return it.
              Otherwise generate a new one.
  - --force: always generate; replaces any existing entry (not common; budget-aware).

Budget guards:
  - Daily token budget cap from auto_config.ANTHROPIC_API_DAILY_BUDGET_TOKENS.
  - Daily counter resets when ANTHROPIC_API_DAILY_RESET_DATE != today.
  - If today's usage + estimated tokens for this call would exceed budget, return
    {"error": "budget_exceeded", ...} WITHOUT calling the API.

Per-call cap: max_tokens output = 600. Input prompt is structured so Haiku has
enough context but stays under 1500 input tokens.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
from datetime import date
from typing import Any, Dict, Optional

DB = "/home/trevor/trevor/trevor.db"
MODEL = "claude-haiku-4-5-20251001"
MAX_OUTPUT_TOKENS = 600
ESTIMATED_INPUT_TOKENS = 1500


def env_anthropic_key() -> Optional[str]:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        return key
    env_path = "/home/trevor/trevor/.env"
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("ANTHROPIC_API_KEY="):
                    val = line.split("=", 1)[1].strip()
                    if val.startswith('"') and val.endswith('"'):
                        val = val[1:-1]
                    elif val.startswith("'") and val.endswith("'"):
                        val = val[1:-1]
                    return val or None
    except OSError:
        return None
    return None


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


def current_budget(conn: sqlite3.Connection) -> Dict[str, int]:
    rows = conn.execute(
        "SELECT key, value FROM auto_config WHERE key IN ("
        "'ANTHROPIC_API_DAILY_TOKENS_USED','ANTHROPIC_API_DAILY_BUDGET_TOKENS')"
    ).fetchall()
    d = dict(rows)
    return {
        "used": int(d.get("ANTHROPIC_API_DAILY_TOKENS_USED", 0) or 0),
        "cap":  int(d.get("ANTHROPIC_API_DAILY_BUDGET_TOKENS", 500_000) or 500_000),
    }


def increment_budget(conn: sqlite3.Connection, tokens_in: int, tokens_out: int) -> None:
    delta = (tokens_in or 0) + (tokens_out or 0)
    conn.execute(
        "UPDATE auto_config SET value=CAST((CAST(value AS INTEGER) + ?) AS TEXT), "
        "updated_at=datetime('now') WHERE key='ANTHROPIC_API_DAILY_TOKENS_USED'",
        (delta,),
    )
    conn.commit()


def fetch_trade_context(conn: sqlite3.Connection, source: str, trade_id: int) -> Optional[Dict[str, Any]]:
    if source != "auto_trades":
        return None
    row = conn.execute(
        """
        SELECT id, ticker, direction, entry_price, exit_price, leverage, notional_usd,
               confidence, signal_confidence, adjusted_confidence,
               pnl_pct, pnl_usd, opened_at, closed_at, exit_reason,
               exit_signals_log, peak_pnl_pct, hold_duration_minutes,
               regime_at_entry, regime_at_exit, market_state, status, trade_mode,
               ai_decision_json, group_scores_json
        FROM auto_trades
        WHERE id = ?
        """,
        (trade_id,),
    ).fetchone()
    if not row:
        return None
    ctx: Dict[str, Any] = dict(row)
    raw_ai = ctx.pop("ai_decision_json", None)
    if raw_ai:
        try:
            decoded = json.loads(raw_ai)
            reasoning = decoded.get("reasoning") if isinstance(decoded, dict) else None
            if reasoning:
                ctx["entry_reasoning"] = reasoning
            decision = decoded.get("decision") if isinstance(decoded, dict) else None
            if decision:
                ctx["entry_decision"] = decision
            adj = decoded.get("adjustment") if isinstance(decoded, dict) else None
            if adj is not None:
                ctx["entry_adjustment"] = adj
        except (ValueError, TypeError):
            pass
    raw_groups = ctx.pop("group_scores_json", None)
    if raw_groups:
        try:
            decoded = json.loads(raw_groups)
            if isinstance(decoded, dict):
                ctx["group_scores"] = decoded
        except (ValueError, TypeError):
            pass
    return ctx


def build_prompt(ctx: Dict[str, Any]) -> str:
    """Structured prompt for Haiku. Strict 3-section output, max 200 words."""
    return (
        "You are TREVOR's trade journalist. Given the trade context below, write a "
        "concise journal entry — at most 200 words, three sections: "
        "(1) ENTRY RATIONALE: what setup the bot saw and why it entered. "
        "(2) WHAT HAPPENED: the path from entry to exit, including any partial peaks. "
        "(3) LESSON: one actionable takeaway, neutral tone, no platitudes. "
        "No headings beyond the three section labels. No emojis. No fluff. Use plain prose."
        "\n\nTRADE CONTEXT:\n" + json.dumps(ctx, default=str, indent=2)
    )


def prompt_hash(prompt: str) -> str:
    return hashlib.sha1(prompt.encode("utf-8")).hexdigest()


def existing_narrative(conn: sqlite3.Connection, source: str, trade_id: int, p_hash: str) -> Optional[Dict[str, Any]]:
    row = conn.execute(
        """
        SELECT id, narrative, model, tokens_input, tokens_output, generated_at, generated_by
        FROM trade_journal
        WHERE trade_source=? AND trade_id=? AND prompt_hash=?
        ORDER BY generated_at DESC LIMIT 1
        """,
        (source, trade_id, p_hash),
    ).fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "narrative": row[1],
        "model": row[2],
        "tokens_input": row[3],
        "tokens_output": row[4],
        "generated_at": row[5],
        "generated_by": row[6],
        "from_cache": True,
    }


def insert_narrative(conn: sqlite3.Connection, source: str, trade_id: int,
                     prompt: str, p_hash: str, narrative: str, tokens_in: int, tokens_out: int,
                     generated_by: str) -> Dict[str, Any]:
    cur = conn.execute(
        """
        INSERT INTO trade_journal
          (trade_source, trade_id, trade_uri, narrative, prompt_hash, model,
           tokens_input, tokens_output, generated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (source, trade_id, f"{source.split('_')[0]}:{trade_id}", narrative, p_hash, MODEL,
         tokens_in, tokens_out, generated_by),
    )
    conn.commit()
    new_id = cur.lastrowid
    row = conn.execute(
        "SELECT generated_at FROM trade_journal WHERE id=?", (new_id,)
    ).fetchone()
    return {
        "id": new_id,
        "narrative": narrative,
        "model": MODEL,
        "tokens_input": tokens_in,
        "tokens_output": tokens_out,
        "generated_at": row[0] if row else None,
        "generated_by": generated_by,
        "from_cache": False,
    }


def call_haiku(prompt: str, api_key: str) -> Dict[str, Any]:
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(
        model=MODEL,
        max_tokens=MAX_OUTPUT_TOKENS,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    return {
        "narrative": text.strip(),
        "tokens_input":  msg.usage.input_tokens if msg.usage else 0,
        "tokens_output": msg.usage.output_tokens if msg.usage else 0,
    }


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: query_journal_narrative.py <trade_source> <trade_id> [--force]"}), file=sys.stderr)
        sys.exit(2)

    source = sys.argv[1]
    try:
        trade_id = int(sys.argv[2])
    except ValueError:
        print(json.dumps({"error": "trade_id must be integer"}), file=sys.stderr)
        sys.exit(2)
    force = "--force" in sys.argv[3:]

    if source not in ("auto_trades",):
        print(json.dumps({"error": f"unsupported trade_source '{source}'"}), file=sys.stderr)
        sys.exit(2)

    api_key = env_anthropic_key()
    if not api_key:
        print(json.dumps({"error": "ANTHROPIC_API_KEY missing"}), file=sys.stderr)
        sys.exit(2)

    with sqlite3.connect(DB, timeout=4.0) as conn:
        conn.row_factory = sqlite3.Row
        reset_daily_budget_if_needed(conn)

        ctx = fetch_trade_context(conn, source, trade_id)
        if ctx is None:
            print(json.dumps({"error": f"trade not found: {source}/{trade_id}"}))
            return

        prompt = build_prompt(ctx)
        p_hash = prompt_hash(prompt)

        if not force:
            cached = existing_narrative(conn, source, trade_id, p_hash)
            if cached:
                print(json.dumps(cached))
                return
        else:
            conn.execute(
                "DELETE FROM trade_journal WHERE trade_source=? AND trade_id=?",
                (source, trade_id),
            )
            conn.commit()

        budget = current_budget(conn)
        projected = budget["used"] + ESTIMATED_INPUT_TOKENS + MAX_OUTPUT_TOKENS
        if projected > budget["cap"]:
            print(json.dumps({
                "error": "budget_exceeded",
                "tokens_used_today": budget["used"],
                "tokens_cap": budget["cap"],
                "projected": projected,
            }))
            return

        try:
            result = call_haiku(prompt, api_key)
        except Exception as exc:
            print(json.dumps({"error": f"api_call_failed: {type(exc).__name__}: {exc}"}))
            return

        increment_budget(conn, result["tokens_input"], result["tokens_output"])

        out = insert_narrative(
            conn, source, trade_id, prompt, p_hash,
            result["narrative"], result["tokens_input"], result["tokens_output"],
            generated_by="ghost",
        )
        print(json.dumps(out))


if __name__ == "__main__":
    main()
