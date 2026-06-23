#!/usr/bin/env python3
"""cost_upsert.py — upsert GCP cost rows into data/hub.db cost_snapshots (B4).

Reads a JSON array of cost rows from STDIN and UPSERTs each into the Hub-owned
cost_snapshots cache (data/hub.db, NOT the read-only trevor.db replica, which is
atomically overwritten every tailsync cycle and would destroy this table). Dedup
is the UNIQUE(snapshot_date, service, sku) key — a refresh overwrites the same
day cleanly via ON CONFLICT DO UPDATE, never duplicating a row.

Called by the cost-refresh route (src/lib/cost-refresh.ts) via runPython, which
queries BigQuery in Node then hands the rows here as stdin JSON. This script does
NO network I/O — python3 stdlib sqlite3 only, matching apply_hub_migration.py and
the rest of the Hub DB layer (C1: hub.db is single-technology = python sqlite3).

Input  (stdin):  JSON array of {snapshot_date, service, gross_cost_usd, net_cost_usd}.
                 sku is always '' here (service-level granularity).
Output (stdout): JSON {"written": <int>, "snapshot_dates": <int distinct days>,
                       "fetched_at": <iso>}
Exit: 0 ok | 1 bad input / db error (stderr carries the reason).
"""
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HUB_DB = os.path.join(REPO_ROOT, "data", "hub.db")
REPLICA = "/home/ghost/trevor-replica/trevor.db"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> int:
    # Guard: never, ever target the read-only replica — it is overwritten each sync.
    if os.path.abspath(HUB_DB) == os.path.abspath(REPLICA):
        print(f"REFUSED: hub DB path resolves to the replica {REPLICA}", file=sys.stderr)
        return 1
    if not os.path.exists(HUB_DB):
        print(f"hub.db missing at {HUB_DB} (run scripts/db/apply_hub_migration.py first)", file=sys.stderr)
        return 1

    try:
        rows = json.load(sys.stdin)
    except Exception as e:  # noqa: BLE001 — any malformed stdin is a clean exit-1
        print(f"bad stdin JSON: {e}", file=sys.stderr)
        return 1
    if not isinstance(rows, list):
        print("stdin JSON must be an array", file=sys.stderr)
        return 1

    fetched_at = _now()
    conn = sqlite3.connect(HUB_DB, isolation_level=None)  # autocommit; we own the txn below
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout=5000;")

        written = 0
        dates = set()
        conn.execute("BEGIN;")
        for r in rows:
            if not isinstance(r, dict):
                conn.execute("ROLLBACK;")
                print(f"bad row (not an object): {r!r}", file=sys.stderr)
                return 1
            try:
                snapshot_date = str(r["snapshot_date"])
                service = str(r["service"]) if r.get("service") not in (None, "") else "(unknown)"
                gross = float(r.get("gross_cost_usd") or 0.0)
                net = float(r.get("net_cost_usd") or 0.0)
            except (KeyError, TypeError, ValueError) as e:
                conn.execute("ROLLBACK;")
                print(f"bad row {r!r}: {e}", file=sys.stderr)
                return 1
            conn.execute(
                """INSERT INTO cost_snapshots
                       (snapshot_date, service, sku, net_cost_usd, gross_cost_usd, fetched_at)
                   VALUES (?, ?, '', ?, ?, ?)
                   ON CONFLICT(snapshot_date, service, sku) DO UPDATE SET
                       net_cost_usd   = excluded.net_cost_usd,
                       gross_cost_usd = excluded.gross_cost_usd,
                       fetched_at     = excluded.fetched_at""",
                (snapshot_date, service, net, gross, fetched_at),
            )
            written += 1
            dates.add(snapshot_date)
        conn.execute("COMMIT;")

        print(json.dumps({
            "written": written,
            "snapshot_dates": len(dates),
            "fetched_at": fetched_at,
        }))
        return 0
    except sqlite3.Error as e:
        try:
            conn.execute("ROLLBACK;")
        except sqlite3.Error:
            pass
        print(f"sqlite error: {e}", file=sys.stderr)
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
