#!/usr/bin/env python3
"""query_cost.py — read the GCP cost cache for the Hub Cost card (B4).

READ-ONLY roll-up of the cost_snapshots cache (C1 created it in the Hub-owned
data/hub.db, NOT the trevor.db replica). NEVER queries BigQuery — the daily
refresh worker (src/lib/cost-refresh.ts → scripts/db/cost_upsert.py) populates
the cache; this reader just aggregates it for the card (fast, on every page load).

Output (ONE JSON object, exit 0 — fail-soft, never raises to the route):
  { status: 'ok' | 'no_data_yet',
    month_label, mtd_total_usd, mtd_gross_usd,
    days_elapsed, days_in_month, projected_month_end_usd,
    last_month_total_usd | null, mom_pct | null,
    breakdown: [{service, net_usd}],  history: [{date, net_usd}],
    fetched_at | null }

The "invoice month" is the current CALENDAR month in UTC (close enough to GCP's
own month boundary for a forecast display). The forecast is a simple linear
projection: mtd / days_elapsed * days_in_month — matches GCP's own method.
"""
import calendar
import json
import os
import sqlite3
from datetime import datetime, timezone, timedelta

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HUB_DB = os.path.join(REPO_ROOT, "data", "hub.db")


def _empty(reason: str) -> dict:
    return {
        "status": "no_data_yet",
        "reason": reason,
        "month_label": None,
        "mtd_total_usd": 0.0,
        "mtd_gross_usd": 0.0,
        "days_elapsed": 0,
        "days_in_month": 0,
        "projected_month_end_usd": 0.0,
        "last_month_total_usd": None,
        "mom_pct": None,
        "breakdown": [],
        "history": [],
        "fetched_at": None,
    }


def main() -> int:
    if not os.path.exists(HUB_DB):
        print(json.dumps(_empty("hub_db_missing")))
        return 0
    try:
        conn = sqlite3.connect(f"file:{HUB_DB}?mode=ro", uri=True)
    except sqlite3.Error as e:
        print(json.dumps({**_empty("db_open_error"), "error": str(e)}))
        return 0

    try:
        total = conn.execute("SELECT COUNT(*) FROM cost_snapshots").fetchone()[0]
        if not total:
            print(json.dumps(_empty("empty_cache")))
            return 0

        now = datetime.now(timezone.utc)
        y, m = now.year, now.month
        month_start = f"{y:04d}-{m:02d}-01"
        days_in_month = calendar.monthrange(y, m)[1]
        days_elapsed = now.day

        # previous calendar month window: [pm_start, month_start)
        pm = datetime(y, m, 1, tzinfo=timezone.utc) - timedelta(days=1)
        pm_start = f"{pm.year:04d}-{pm.month:02d}-01"

        net_row = conn.execute(
            "SELECT COALESCE(SUM(net_cost_usd),0), COALESCE(SUM(gross_cost_usd),0) "
            "FROM cost_snapshots WHERE snapshot_date >= ?",
            (month_start,),
        ).fetchone()
        mtd_net = float(net_row[0])
        mtd_gross = float(net_row[1])

        lm_rows = conn.execute(
            "SELECT COUNT(*), COALESCE(SUM(net_cost_usd),0) FROM cost_snapshots "
            "WHERE snapshot_date >= ? AND snapshot_date < ?",
            (pm_start, month_start),
        ).fetchone()
        has_last_month = lm_rows[0] > 0
        last_month_total = float(lm_rows[1])

        projected = (mtd_net / days_elapsed * days_in_month) if days_elapsed > 0 else mtd_net

        mom_pct = None
        if has_last_month and last_month_total > 0:
            mom_pct = round((projected - last_month_total) / last_month_total * 100, 1)

        breakdown = [
            {"service": r[0], "net_usd": round(float(r[1]), 4)}
            for r in conn.execute(
                "SELECT service, SUM(net_cost_usd) FROM cost_snapshots "
                "WHERE snapshot_date >= ? GROUP BY service ORDER BY 2 DESC",
                (month_start,),
            ).fetchall()
        ]

        hist_start = (now - timedelta(days=30)).strftime("%Y-%m-%d")
        history = [
            {"date": r[0], "net_usd": round(float(r[1]), 4)}
            for r in conn.execute(
                "SELECT snapshot_date, SUM(net_cost_usd) FROM cost_snapshots "
                "WHERE snapshot_date >= ? GROUP BY snapshot_date ORDER BY snapshot_date",
                (hist_start,),
            ).fetchall()
        ]

        fetched_at = conn.execute("SELECT MAX(fetched_at) FROM cost_snapshots").fetchone()[0]

        print(json.dumps({
            "status": "ok",
            "month_label": now.strftime("%B %Y"),
            "mtd_total_usd": round(mtd_net, 2),
            "mtd_gross_usd": round(mtd_gross, 2),
            "days_elapsed": days_elapsed,
            "days_in_month": days_in_month,
            "projected_month_end_usd": round(projected, 2),
            "last_month_total_usd": round(last_month_total, 2) if has_last_month else None,
            "mom_pct": mom_pct,
            "breakdown": breakdown,
            "history": history,
            "fetched_at": fetched_at,
        }))
        return 0
    except sqlite3.Error as e:
        print(json.dumps({**_empty("query_error"), "error": str(e)}))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
