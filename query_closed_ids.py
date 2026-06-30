#!/usr/bin/env python3
"""
Replica closed-history cross-check for the live open-set (B1 HEARTBEAT-FAILSAFE,
2026-06-30).

Given a set of candidate trade ids (the heartbeat's "open" set), return ONLY the
ids the litestream replica explicitly marks `status='closed'`. The consumer
(/api/auto/trades?type=open) evicts those ids from the live set so a closed row
served as still-open by a stale heartbeat / persistent in-memory cache (the
−17% HYPE ghost, closed row 101112) can never render as an open card.

CRITICAL — absence ≠ closed. An id NOT present in the replica (a real, fast-
syncing live position not yet replicated — e.g. FARTCOIN #101066) returns
NOTHING here, so it is never evicted. ONLY an explicit `status='closed'` row is
returned.

Args:
  argv[1..] = candidate trade ids (ints). Non-int / extra tokens are ignored.
              May also be a single comma-separated list ("101112,101065").

JSON output:
  { "closed_ids": [<int>, ...] }   # subset of the inputs that are status='closed'

Notes:
- READ-ONLY (`file:...?mode=ro`).
- Always prints one JSON object; the consumer fails OPEN (keeps the set) on any
  error, so the Phase-2 staleness ceiling still bounds the risk.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

DB = "/home/trevor/trevor/trevor.db"


def _connect_ro() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10)


def _parse_ids(argv: list[str]) -> list[int]:
    ids: list[int] = []
    seen: set[int] = set()
    for tok in argv:
        for part in str(tok).split(","):
            part = part.strip()
            if not part:
                continue
            try:
                v = int(part)
            except ValueError:
                continue
            if v not in seen:
                seen.add(v)
                ids.append(v)
    return ids


def closed_ids(ids: list[int]) -> list[int]:
    if not ids:
        return []
    # Sanctioned dynamic-IN idiom: placeholder MARKS only, values bound as params
    # (never interpolated) — injection-safe.
    placeholders = ",".join("?" for _ in ids)
    with _connect_ro() as conn:
        cur = conn.execute(
            f"SELECT id FROM auto_trades WHERE id IN ({placeholders}) AND status='closed'",
            ids,
        )
        return [int(row[0]) for row in cur.fetchall()]


def main() -> int:
    ids = _parse_ids(sys.argv[1:])
    if not Path(DB).exists():
        sys.stdout.write(json.dumps({"closed_ids": [], "error": f"DB not found: {DB}"}))
        return 1
    try:
        out = closed_ids(ids)
        sys.stdout.write(json.dumps({"closed_ids": out}))
        return 0
    except Exception as exc:
        sys.stdout.write(json.dumps({
            "closed_ids": [],
            "error": f"{type(exc).__name__}: {exc}",
        }))
        return 1


if __name__ == "__main__":
    # OUTER-WRAP (silent-crash visibility), mirrors query_auto_trades.py.
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
