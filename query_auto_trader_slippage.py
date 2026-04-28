"""
READ-ONLY query helper for the Hub Auto Trader → Slippage histogram.

Returns the last N entries from `slippage_audit` (default 100) so the Hub
can render a bar chart of execution-quality slippage in basis points. Pure
SELECT against `trevor.db` via `mode=ro` URI; never mutates DB state.

Stdout shape:
{
    "rows": [
        {
            "id": int,
            "trade_id": int | null,
            "ticker": str,
            "direction": str | null,
            "planned_price": float,
            "actual_price": float,
            "slippage_bps": float,
            "slippage_pct": float,
            "impact_usd": float | null,
            "alerted": int,           # 0/1
            "created_at": str         # ISO ET via datetime() conversion
        },
        ...
    ],
    "total": int,
    "summary": {
        "n": int,
        "avg_bps": float,
        "p50_bps": float,
        "p95_bps": float,
        "max_bps": float,
        "alerted_count": int
    }
}
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys

DB_PATH = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=5.0)
    conn.row_factory = sqlite3.Row
    return conn


def _percentile(sorted_values: list[float], pct: float) -> float:
    if not sorted_values:
        return 0.0
    idx = max(0, min(len(sorted_values) - 1, int(round(pct * (len(sorted_values) - 1)))))
    return float(sorted_values[idx])


def query_slippage(limit: int = 100) -> dict:
    try:
        limit = max(1, min(500, int(limit)))
    except Exception:
        limit = 100
    rows: list[dict] = []
    summary = {"n": 0, "avg_bps": 0.0, "p50_bps": 0.0, "p95_bps": 0.0, "max_bps": 0.0, "alerted_count": 0}
    total = 0
    try:
        conn = _conn()
        try:
            total_row = conn.execute("SELECT COUNT(*) FROM slippage_audit").fetchone()
            total = int(total_row[0]) if total_row else 0

            cur = conn.execute(
                "SELECT id, trade_id, ticker, direction, planned_price, actual_price, "
                "       slippage_bps, slippage_pct, impact_usd, alerted, created_at "
                "FROM slippage_audit "
                "ORDER BY id DESC "
                "LIMIT ?",
                (limit,),
            )
            raw = [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()

        # Reverse so the chart shows oldest → newest (bar chart x-axis)
        raw.reverse()

        bps_values: list[float] = []
        for r in raw:
            r["planned_price"] = float(r.get("planned_price") or 0.0)
            r["actual_price"] = float(r.get("actual_price") or 0.0)
            r["slippage_bps"] = float(r.get("slippage_bps") or 0.0)
            r["slippage_pct"] = float(r.get("slippage_pct") or 0.0)
            r["impact_usd"] = float(r["impact_usd"]) if r.get("impact_usd") is not None else None
            r["alerted"] = int(r.get("alerted") or 0)
            r["trade_id"] = int(r["trade_id"]) if r.get("trade_id") is not None else None
            r["direction"] = (r.get("direction") or None)
            r["ticker"] = str(r.get("ticker") or "?")
            bps_values.append(abs(r["slippage_bps"]))
            rows.append(r)

        if bps_values:
            sorted_bps = sorted(bps_values)
            summary = {
                "n": len(bps_values),
                "avg_bps": round(sum(bps_values) / len(bps_values), 3),
                "p50_bps": round(_percentile(sorted_bps, 0.50), 3),
                "p95_bps": round(_percentile(sorted_bps, 0.95), 3),
                "max_bps": round(sorted_bps[-1], 3),
                "alerted_count": sum(1 for r in rows if r["alerted"] == 1),
            }
    except Exception as exc:
        return {"rows": [], "total": 0, "summary": summary, "error": str(exc)}

    return {"rows": rows, "total": total, "summary": summary}


if __name__ == "__main__":
    limit = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 100
    print(json.dumps(query_slippage(limit), default=str))
