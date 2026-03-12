#!/usr/bin/env python3
"""Query portfolio data from trevor.db for Hub API."""
import json
import sqlite3
import sys

db_path = sys.argv[1] if len(sys.argv) > 1 else "/home/trevor/trevor/trevor.db"
scope = sys.argv[2] if len(sys.argv) > 2 else "open"

conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row

if scope == "open":
    rows = conn.execute(
        "SELECT * FROM portfolio_positions WHERE status='open' ORDER BY asset_type, opened_at DESC"
    ).fetchall()
    positions = [dict(r) for r in rows]

    stocks_etfs = [p for p in positions if p["asset_type"] in ("stock", "etf")]
    crypto_spot = [p for p in positions if p["asset_type"] == "crypto_spot"]
    crypto_perps = [p for p in positions if p["asset_type"] == "crypto_perp"]

    total_value = 0.0
    total_pnl = 0.0
    total_entry = 0.0
    by_category = {}

    for cat, label in [("stocks_etfs", ("stock", "etf")), ("crypto_spot", ("crypto_spot",)), ("crypto_perps", ("crypto_perp",))]:
        cat_positions = [p for p in positions if p["asset_type"] in label]
        cat_value = sum((p.get("current_price") or p["entry_price"]) * p["quantity"] for p in cat_positions)
        cat_pnl = sum(p.get("unrealized_pnl") or 0 for p in cat_positions)
        cat_entry = sum(p["entry_price"] * p["quantity"] for p in cat_positions)
        by_category[cat] = {"count": len(cat_positions), "value": round(cat_value, 2), "pnl": round(cat_pnl, 2)}
        total_value += cat_value
        total_pnl += cat_pnl
        total_entry += cat_entry

    total_pnl_pct = (total_pnl / total_entry * 100) if total_entry else 0

    result = {
        "stocks_etfs": stocks_etfs,
        "crypto_spot": crypto_spot,
        "crypto_perps": crypto_perps,
        "summary": {
            "total_value": round(total_value, 2),
            "total_unrealized_pnl": round(total_pnl, 2),
            "total_unrealized_pnl_pct": round(total_pnl_pct, 2),
            "position_count": len(positions),
            "by_category": by_category,
        },
    }

elif scope == "history":
    rows = conn.execute(
        "SELECT * FROM portfolio_positions WHERE status='closed' ORDER BY closed_at DESC LIMIT 100"
    ).fetchall()
    positions = [dict(r) for r in rows]

    total_pnl = sum(p.get("realized_pnl") or 0 for p in positions)
    wins = sum(1 for p in positions if (p.get("realized_pnl") or 0) > 0)
    losses = sum(1 for p in positions if (p.get("realized_pnl") or 0) < 0)

    result = {
        "positions": positions,
        "total_realized_pnl": round(total_pnl, 2),
        "total_trades": len(positions),
        "win_count": wins,
        "loss_count": losses,
    }

conn.close()
print(json.dumps(result, default=str))
