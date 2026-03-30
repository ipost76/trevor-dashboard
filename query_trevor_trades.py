#!/usr/bin/env python3
"""Read-only query helper for TREVOR trade data (trade_outcomes + active_trades).
Never writes to any TREVOR table."""

import sqlite3, json, sys, os, math
from datetime import datetime, timezone

DB_PATH = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")


def fmt_hold(opened_at, closed_at):
    """Format hold duration as human-readable string."""
    if not opened_at or not closed_at:
        return "\u2014"
    try:
        fmt1 = "%Y-%m-%dT%H:%M:%S.%f" if "T" in opened_at else "%Y-%m-%d %H:%M:%S"
        fmt2 = "%Y-%m-%dT%H:%M:%S.%f" if "T" in closed_at else "%Y-%m-%d %H:%M:%S"
        o = datetime.strptime(opened_at.split("+")[0].split("Z")[0], fmt1)
        c = datetime.strptime(closed_at.split("+")[0].split("Z")[0], fmt2)
        total_min = max(0, int((c - o).total_seconds() / 60))
        h, m = divmod(total_min, 60)
        if h >= 24:
            d, rh = divmod(h, 24)
            return f"{d}d {rh}h"
        return f"{h}h {m}m"
    except Exception:
        return "\u2014"


def main():
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row

    # Active positions
    active = []
    try:
        rows = conn.execute("""
            SELECT trade_id, ticker, direction, entry_price, stop_price, target_price,
                   leverage, confidence, track, opened_at, margin_usd
            FROM active_trades WHERE status='open'
            ORDER BY opened_at DESC
        """).fetchall()
        for r in rows:
            active.append({
                "trade_id": r["trade_id"], "ticker": r["ticker"],
                "direction": r["direction"] or "?",
                "entry_price": r["entry_price"], "leverage": r["leverage"] or 1,
                "stop_price": r["stop_price"], "target_price": r["target_price"],
                "confidence": int(r["confidence"] or 0),
                "track": r["track"] or "scalp",
                "opened_at": r["opened_at"] or "",
                "margin_usd": r["margin_usd"],
                "source": "trevor",
            })
    except Exception:
        pass

    # Closed trades from active_trades (has both opened_at + closed_at)
    history = []
    try:
        rows = conn.execute("""
            SELECT trade_id, ticker, direction, entry_price, exit_price, pnl_pct,
                   leverage, confidence, track, opened_at, closed_at
            FROM active_trades WHERE status='closed'
            ORDER BY closed_at DESC
        """).fetchall()
        for r in rows:
            pnl = r["pnl_pct"] or 0
            history.append({
                "trade_id": r["trade_id"], "ticker": r["ticker"],
                "direction": r["direction"] or "?",
                "entry_price": r["entry_price"], "exit_price": r["exit_price"],
                "pnl_pct": round(pnl, 2),
                "outcome": "WIN" if pnl > 0 else "LOSS",
                "leverage": r["leverage"] or 1,
                "confidence": int(r["confidence"] or 0),
                "track": r["track"] or "scalp",
                "opened_at": r["opened_at"] or "",
                "closed_at": r["closed_at"] or "",
                "hold_duration": fmt_hold(r["opened_at"], r["closed_at"]),
                "source": "trevor",
            })
    except Exception:
        pass

    # Manual trades from ghost_trades
    manual = []
    try:
        rows = conn.execute("""
            SELECT id, ticker, direction, entry_price, exit_price, leverage,
                   pnl_pct, outcome, notes, source, opened_at, closed_at
            FROM ghost_trades ORDER BY created_at DESC
        """).fetchall()
        for r in rows:
            manual.append({
                "id": r["id"], "ticker": r["ticker"],
                "direction": r["direction"] or "?",
                "entry_price": r["entry_price"], "exit_price": r["exit_price"],
                "pnl_pct": round(r["pnl_pct"] or 0, 2) if r["pnl_pct"] else None,
                "outcome": r["outcome"],
                "leverage": r["leverage"] or 1,
                "notes": r["notes"], "source": "manual",
                "opened_at": r["opened_at"] or "",
                "closed_at": r["closed_at"] or "",
            })
    except Exception:
        pass

    # Stats from closed trades (TREVOR only — ghost_trades is manual journal)
    wins = [t for t in history if t["pnl_pct"] > 0]
    losses = [t for t in history if t["pnl_pct"] <= 0]
    pnls = [t["pnl_pct"] for t in history]
    total = len(history)

    stats = {
        "total": total,
        "wins": len(wins),
        "losses": len(losses),
        "winRate": round(len(wins) / total * 100, 1) if total > 0 else 0,
        "avgPnl": round(sum(pnls) / total, 2) if total > 0 else 0,
        "totalPnl": round(sum(pnls), 2),
        "bestTrade": None,
        "worstTrade": None,
        "activeCount": len(active),
    }
    if pnls:
        best_idx = pnls.index(max(pnls))
        worst_idx = pnls.index(min(pnls))
        stats["bestTrade"] = {"ticker": history[best_idx]["ticker"], "pnl_pct": max(pnls)}
        stats["worstTrade"] = {"ticker": history[worst_idx]["ticker"], "pnl_pct": min(pnls)}

    conn.close()
    print(json.dumps({"active": active, "history": history, "manual": manual, "stats": stats}))


if __name__ == "__main__":
    main()
