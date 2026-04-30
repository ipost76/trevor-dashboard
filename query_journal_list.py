#!/usr/bin/env python3
"""
List recent closed trades with their journal-narrative status.

JSON output:
{
  "trades": [
    {
      "trade_uri": "auto:1234",
      "trade_source": "auto_trades",
      "trade_id": 1234,
      "ticker": "BTC",
      "direction": "LONG",
      "pnl_pct": 1.42,
      "pnl_usd": 0.71,
      "closed_at": "...",
      "has_narrative": true,
      "narrative_id": 9
    },
    ...
  ],
  "budget": { "used": 1234, "cap": 500000, "reset_date": "..." }
}
"""
from __future__ import annotations
import json
import sqlite3
import sys

DB = "/home/trevor/trevor/trevor.db"


def main():
    limit = 30
    try:
        if len(sys.argv) >= 2:
            limit = max(1, min(100, int(sys.argv[1])))
    except ValueError:
        limit = 30

    try:
        with sqlite3.connect(DB, timeout=4.0) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                f"""
                SELECT
                  at.id AS trade_id,
                  at.ticker, at.direction, at.pnl_pct, at.pnl_usd, at.closed_at,
                  at.opened_at, at.exit_reason,
                  EXISTS(SELECT 1 FROM trade_journal tj
                         WHERE tj.trade_source='auto_trades' AND tj.trade_id=at.id) AS has_narrative,
                  (SELECT id FROM trade_journal tj
                    WHERE tj.trade_source='auto_trades' AND tj.trade_id=at.id
                    ORDER BY generated_at DESC LIMIT 1) AS narrative_id
                FROM auto_trades at
                WHERE at.status='closed' AND at.trade_mode='live'
                ORDER BY at.closed_at DESC
                LIMIT {limit}
                """
            ).fetchall()
            budget_rows = conn.execute(
                "SELECT key, value FROM auto_config WHERE key IN ("
                "'ANTHROPIC_API_DAILY_TOKENS_USED','ANTHROPIC_API_DAILY_BUDGET_TOKENS','ANTHROPIC_API_DAILY_RESET_DATE')"
            ).fetchall()
        budget = dict(budget_rows)
        print(json.dumps({
            "trades": [
                {
                    "trade_uri": f"auto:{r['trade_id']}",
                    "trade_source": "auto_trades",
                    "trade_id": r["trade_id"],
                    "ticker": r["ticker"],
                    "direction": r["direction"],
                    "pnl_pct": float(r["pnl_pct"] or 0),
                    "pnl_usd": float(r["pnl_usd"] or 0),
                    "closed_at": r["closed_at"],
                    "opened_at": r["opened_at"],
                    "exit_reason": r["exit_reason"],
                    "has_narrative": bool(r["has_narrative"]),
                    "narrative_id": r["narrative_id"],
                }
                for r in rows
            ],
            "budget": {
                "used": int(budget.get("ANTHROPIC_API_DAILY_TOKENS_USED", 0) or 0),
                "cap":  int(budget.get("ANTHROPIC_API_DAILY_BUDGET_TOKENS", 500_000) or 500_000),
                "reset_date": budget.get("ANTHROPIC_API_DAILY_RESET_DATE", ""),
            },
        }))
    except Exception as exc:
        print(json.dumps({"trades": [], "budget": {}, "error": str(exc)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
