#!/usr/bin/env python3
"""Query live dashboard data from trevor.db. Used by Hub /api/live route."""
import json
import os
import sqlite3
import sys

db_path = sys.argv[1] if len(sys.argv) > 1 else "/home/trevor/trevor/trevor.db"
result = {}

try:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)

    # XP
    try:
        result["xp"] = int(conn.execute("SELECT COALESCE(SUM(amount),0) FROM xp_ledger").fetchone()[0] or 0)
    except Exception:
        result["xp"] = 0

    # Trade insights count
    try:
        result["total"] = conn.execute("SELECT COUNT(*) FROM trade_insights").fetchone()[0]
    except Exception:
        result["total"] = 0

    # Trade outcomes
    try:
        rows = conn.execute(
            "SELECT COUNT(*), "
            "SUM(CASE WHEN exit_reason='WIN' THEN 1 ELSE 0 END), "
            "SUM(CASE WHEN exit_reason='LOSS' THEN 1 ELSE 0 END) "
            "FROM trade_outcomes WHERE excluded = 0 OR excluded IS NULL"
        ).fetchone()
        result["outcomes"] = {"decided": rows[0] or 0, "wins": int(rows[1] or 0), "losses": int(rows[2] or 0)}
    except Exception:
        result["outcomes"] = {"decided": 0, "wins": 0, "losses": 0}

    # Recent trade insights
    try:
        rows = conn.execute(
            "SELECT id, ticker, signal_type, confidence, entry_price, target_price, "
            "stop_price, outcome, created_at FROM trade_insights "
            "ORDER BY created_at DESC LIMIT 15"
        ).fetchall()
        result["recent"] = [{
            "id": r[0], "ticker": r[1], "signal_type": r[2] or "",
            "direction": "LONG", "confidence": round(float(r[3] or 0) * 100) if r[3] and float(r[3]) <= 1 else int(r[3] or 0),
            "entry_price": r[4], "target_price": r[5], "stop_price": r[6],
            "outcome": r[7], "timestamp": r[8] or ""
        } for r in rows]
    except Exception:
        result["recent"] = []

    # Watchlist
    try:
        rows = conn.execute("SELECT ticker, mode, asset_type, notes, priority FROM watchlist ORDER BY ticker").fetchall()
        result["watchlist"] = [{"ticker": r[0], "mode": r[1] or "lt", "asset_type": r[2] or "stock", "notes": r[3] or "", "priority": r[4] or 2} for r in rows]
    except Exception:
        result["watchlist"] = []

    # Training stats (cached — these tables are huge and rarely change)
    cache_path = "/tmp/trevor_training_cache.json"
    try:
        import time as _time
        cache_valid = False
        if os.path.exists(cache_path):
            age = _time.time() - os.path.getmtime(cache_path)
            if age < 3600:  # 1 hour cache
                with open(cache_path) as _cf:
                    result["training"] = json.load(_cf)
                    cache_valid = True
        if not cache_valid:
            tt = conn.execute("SELECT COUNT(*) FROM training_trades").fetchone()[0]
            to2 = conn.execute("SELECT COUNT(*) FROM training_observations").fetchone()[0]
            ts = conn.execute("SELECT COUNT(*) FROM training_sentiment").fetchone()[0]
            result["training"] = {"trades": tt, "observations": to2, "sentiment": ts}
            with open(cache_path, "w") as _cf:
                json.dump(result["training"], _cf)
    except Exception:
        result["training"] = {"trades": 0, "observations": 0, "sentiment": 0}

    # Cost tracking (today)
    try:
        cost = conn.execute("SELECT COALESCE(SUM(cost_usd),0) FROM cost_tracking WHERE date=date('now')").fetchone()[0]
        result["cost_today"] = round(float(cost or 0), 4)
    except Exception:
        result["cost_today"] = 0

    # Security events (last 20)
    try:
        rows = conn.execute(
            "SELECT id, event_type, severity, description, file_path, created_at "
            "FROM security_events ORDER BY created_at DESC LIMIT 20"
        ).fetchall()
        result["security"] = [{"id": r[0], "event_type": r[1], "severity": r[2], "description": r[3], "file_path": r[4], "created_at": r[5]} for r in rows]
    except Exception:
        result["security"] = []

    # DB size
    try:
        result["db_size_mb"] = round(os.path.getsize(db_path) / 1048576, 1)
    except Exception:
        result["db_size_mb"] = 0

    conn.close()
except Exception as e:
    result["error"] = str(e)

print(json.dumps(result))
