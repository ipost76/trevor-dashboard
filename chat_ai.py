#!/usr/bin/env python3
"""
chat_ai.py — TREVOR Chat AI backend.
Direct Anthropic API calls with read-only TREVOR data context.

Reads JSON from stdin: {"messages": [{"role": "user", "content": "..."}]}
Outputs JSON to stdout: {"reply": "...", "tokens": {"input": N, "output": N}}
"""
import sys
import json
import sqlite3
import os
import re

# Load API key from bot's .env
from dotenv import load_dotenv
load_dotenv("/home/trevor/trevor/.env")

from anthropic import Anthropic

TREVOR_DB = "/home/trevor/trevor/trevor.db"
AUTOTRADER_DB = "/home/trevor/trevor/autotrader/autotrader.db"
IDENTITY_FILE = "/home/trevor/trevor/brain/IDENTITY.md"

client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))


# ═══════════════════════════════════════════════════════
# READ-ONLY DATA RETRIEVAL
# ═══════════════════════════════════════════════════════

def _query_trevor(sql, params=()):
    try:
        conn = sqlite3.connect(f"file:{TREVOR_DB}?mode=ro", uri=True, timeout=10)
        cur = conn.execute(sql, params)
        rows = cur.fetchall()
        cols = [d[0] for d in cur.description] if cur.description else []
        conn.close()
        return [dict(zip(cols, r)) for r in rows]
    except Exception as e:
        return [{"error": str(e)}]


def _query_autotrader(sql, params=()):
    try:
        if not os.path.exists(AUTOTRADER_DB):
            return [{"error": "AutoTrader DB not found"}]
        conn = sqlite3.connect(f"file:{AUTOTRADER_DB}?mode=ro", uri=True, timeout=10)
        cur = conn.execute(sql, params)
        rows = cur.fetchall()
        cols = [d[0] for d in cur.description] if cur.description else []
        conn.close()
        return [dict(zip(cols, r)) for r in rows]
    except Exception as e:
        return [{"error": str(e)}]


def get_trade_performance():
    # Aggressive-mode exclusion: LEFT JOIN on insight_id + COALESCE(ti.aggressive_mode,0)=0.
    # NOTE: trade_outcomes.insight_id is currently NULL for all existing rows — filter is
    # a no-op today but future-proof. NULL treated as non-aggressive (correct default).
    return _query_trevor("""
        SELECT COUNT(*) as total,
            SUM(CASE WHEN too.pnl_pct > 0 THEN 1 ELSE 0 END) as wins,
            SUM(CASE WHEN too.pnl_pct < 0 THEN 1 ELSE 0 END) as losses,
            ROUND(100.0 * SUM(CASE WHEN too.pnl_pct > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) as win_rate,
            ROUND(AVG(CASE WHEN too.pnl_pct > 0 THEN too.pnl_pct END), 2) as avg_winner,
            ROUND(AVG(CASE WHEN too.pnl_pct < 0 THEN too.pnl_pct END), 2) as avg_loser,
            ROUND(AVG(too.pnl_pct), 2) as avg_pnl,
            ROUND(MIN(too.pnl_pct), 2) as worst_trade,
            ROUND(MAX(too.pnl_pct), 2) as best_trade
        FROM trade_outcomes too
        LEFT JOIN trade_insights ti ON too.insight_id = ti.id
        WHERE COALESCE(ti.aggressive_mode, 0) = 0
    """)


def get_ticker_breakdown():
    # Aggressive-mode exclusion via LEFT JOIN (same pattern as get_trade_performance)
    return _query_trevor("""
        SELECT too.ticker, COUNT(*) as total,
            SUM(CASE WHEN too.pnl_pct > 0 THEN 1 ELSE 0 END) as wins,
            ROUND(100.0 * SUM(CASE WHEN too.pnl_pct > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) as win_rate,
            ROUND(AVG(too.pnl_pct), 2) as avg_pnl
        FROM trade_outcomes too
        LEFT JOIN trade_insights ti ON too.insight_id = ti.id
        WHERE COALESCE(ti.aggressive_mode, 0) = 0
        GROUP BY too.ticker ORDER BY total DESC
    """)


def get_recent_signals(limit=10):
    # Direct NULL-safe filter — excludes aggressive-tagged signals from chat context
    return _query_trevor("""
        SELECT ticker, signal_type as direction, confidence, entry_price, created_at
        FROM trade_insights
        WHERE (aggressive_mode = 0 OR aggressive_mode IS NULL)
        ORDER BY created_at DESC LIMIT ?
    """, (limit,))


def get_active_trades():
    return _query_trevor("""
        SELECT ticker, direction, entry_price, leverage, margin_usd, confidence, created_at
        FROM active_trades WHERE status = 'open'
    """)


def get_autotrader_stats():
    return _query_autotrader("""
        SELECT COUNT(*) as total,
            SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
            SUM(CASE WHEN pnl <= 0 THEN 1 ELSE 0 END) as losses,
            ROUND(SUM(pnl), 2) as total_pnl,
            ROUND(AVG(pnl), 2) as avg_pnl
        FROM trades WHERE exit_price IS NOT NULL
    """)


def get_calibration():
    return _query_trevor("""
        SELECT
            CASE
                WHEN confidence BETWEEN 35 AND 44 THEN '35-44'
                WHEN confidence BETWEEN 45 AND 54 THEN '45-54'
                WHEN confidence BETWEEN 55 AND 64 THEN '55-64'
                WHEN confidence BETWEEN 65 AND 74 THEN '65-74'
                WHEN confidence >= 75 THEN '75+'
            END as bucket,
            COUNT(*) as total,
            SUM(CASE WHEN pnl_pct > 0 THEN 1 ELSE 0 END) as wins,
            ROUND(100.0 * SUM(CASE WHEN pnl_pct > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) as win_rate
        FROM active_trades
        WHERE status = 'closed' AND confidence IS NOT NULL AND pnl_pct IS NOT NULL
        GROUP BY bucket ORDER BY bucket
    """)


# ═══════════════════════════════════════════════════════
# CONTEXT BUILDER
# ═══════════════════════════════════════════════════════

def build_context(message):
    lower = message.lower()
    ctx = "\n## Trade Performance\n" + json.dumps(get_trade_performance(), indent=2)

    if re.search(r"ticker|btc|eth|sol|hype|fartcoin|per.*ticker|which.*coin|breakdown", lower):
        ctx += "\n\n## Ticker Breakdown\n" + json.dumps(get_ticker_breakdown(), indent=2)

    if re.search(r"signal|recent|latest|scan|today", lower):
        ctx += "\n\n## Recent Signals (last 10)\n" + json.dumps(get_recent_signals(10), indent=2)

    if re.search(r"active|open|position|trade.*open", lower):
        ctx += "\n\n## Active Trades\n" + json.dumps(get_active_trades(), indent=2)

    if re.search(r"autotrader|auto.*trad|alpaca|paper", lower):
        ctx += "\n\n## AutoTrader Stats\n" + json.dumps(get_autotrader_stats(), indent=2)

    if re.search(r"confidence|calibrat|threshold|regime", lower):
        ctx += "\n\n## Confidence Calibration\n" + json.dumps(get_calibration(), indent=2)

    return ctx


# ═══════════════════════════════════════════════════════
# SYSTEM PROMPT
# ═══════════════════════════════════════════════════════

def get_system_prompt(data_context):
    identity = ""
    try:
        if os.path.exists(IDENTITY_FILE):
            with open(IDENTITY_FILE, "r") as f:
                identity = f.read()[:2000]
    except Exception:
        pass

    return f"""You are TREVOR — Ghost's quant trading analysis partner. You are speaking directly with Ghost through the Hub chat interface.

{identity}

## Your Role in This Chat
- You are a READ-ONLY advisor. You can analyze data, answer questions, explain signals, and give recommendations.
- You CANNOT execute trades, modify settings, restart services, or change any system state.
- If Ghost asks you to DO something (change a setting, fix a bug, deploy code), tell them this needs to be done via Claude Code or SSH.
- Be direct, concise, and quantitative. Ghost is a quant trader — use numbers, not fluff.
- Keep responses short. Ghost is usually on mobile.

## Current System Data
{data_context}

## Sacred Watchlist
BTC, ETH, SOL, HYPE, FARTCOIN (crypto perps only)

## Key Context
- Signal confidence model is being recalibrated (historical inverse correlation found)
- AutoTrader is currently PAUSED (PF: 0.02, WR: 23%)
- 5-group confluence model: Momentum, Trend, Volume, Volatility, Microstructure
- Regime-adaptive thresholds applied via signal_guard.py"""


def main():
    raw = sys.stdin.read().strip()
    if not raw:
        print(json.dumps({"error": "No input"}))
        return

    data = json.loads(raw)
    messages = data.get("messages", [])
    if not messages:
        print(json.dumps({"error": "No messages"}))
        return

    last_msg = messages[-1].get("content", "")
    context = build_context(last_msg)
    system = get_system_prompt(context)

    # Keep last 10 messages
    api_messages = [{"role": m["role"], "content": m["content"]} for m in messages[-10:]]

    try:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system=system,
            messages=api_messages,
        )
        reply = response.content[0].text if response.content else "No response."
        print(json.dumps({
            "reply": reply,
            "tokens": {
                "input": response.usage.input_tokens,
                "output": response.usage.output_tokens,
            },
        }))
    except Exception as e:
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
