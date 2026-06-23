#!/usr/bin/env python3
"""apply_hub_migration.py — idempotent migration runner for the Hub-owned DB.

The Hub has no DB of its own historically (it reads the trevor.db replica mode=ro,
which is atomically overwritten every tailsync cycle). Hub-owned writable state
that must SURVIVE the swap lives here: data/hub.db. This runner creates that DB
(WAL mode), then applies any migrations/*.sql not yet recorded in _migrations.

WSL has no sqlite3 CLI — this uses python3's stdlib sqlite3, like the rest of the Hub.

Safe to re-run: already-applied migrations are skipped. If hub.db already exists
with data, it is backed up (sqlite online backup) before any migration runs.

Usage:  python3 scripts/db/apply_hub_migration.py
"""
import os
import sqlite3
import sys
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HUB_DB = os.path.join(REPO_ROOT, "data", "hub.db")
MIGRATIONS_DIR = os.path.join(REPO_ROOT, "migrations")
REPLICA = "/home/ghost/trevor-replica/trevor.db"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> int:
    # Guard: never, ever target the read-only replica — it is overwritten each sync.
    if os.path.abspath(HUB_DB) == os.path.abspath(REPLICA):
        print(f"REFUSED: hub DB path resolves to the replica {REPLICA}", file=sys.stderr)
        return 2

    os.makedirs(os.path.dirname(HUB_DB), exist_ok=True)
    pre_existing = os.path.exists(HUB_DB) and os.path.getsize(HUB_DB) > 0

    conn = sqlite3.connect(HUB_DB, isolation_level=None)  # autocommit; .sql files own their txns
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout=5000;")

        # Backup an already-populated DB before mutating it (no-op on a brand-new DB).
        if pre_existing:
            bak = f"{HUB_DB}.bak-{datetime.now(timezone.utc).strftime('%Y%m%d')}"
            with sqlite3.connect(bak) as bconn:
                conn.backup(bconn)
            print(f"backup: {bak}")
        else:
            print("backup: skipped (hub.db is brand-new / empty — nothing to back up)")

        conn.execute(
            """CREATE TABLE IF NOT EXISTS _migrations (
                   filename   TEXT PRIMARY KEY,
                   applied_at TEXT NOT NULL
               );"""
        )

        applied = {r[0] for r in conn.execute("SELECT filename FROM _migrations")}
        files = sorted(f for f in os.listdir(MIGRATIONS_DIR) if f.endswith(".sql"))

        ran = 0
        for fn in files:
            if fn in applied:
                print(f"skip:  {fn} (already applied)")
                continue
            with open(os.path.join(MIGRATIONS_DIR, fn), "r", encoding="utf-8") as fh:
                conn.executescript(fh.read())
            conn.execute(
                "INSERT INTO _migrations(filename, applied_at) VALUES (?, ?)",
                (fn, _now()),
            )
            print(f"apply: {fn}")
            ran += 1

        print(f"done: {ran} migration(s) applied, db={HUB_DB}")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
