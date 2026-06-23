#!/usr/bin/env python3
"""query_servant_findings.py — READ-ONLY reader for the SERVANT edge-hunter (B5).

Backs the SERVANT zone (/servant):
  - /api/servant/findings → the ranked open-findings list + report-state header.

Reads the litestream replica (`/home/trevor/trevor/trevor.db`, a symlink to
`/home/ghost/trevor-replica/trevor.db` on WSL) opened READ-ONLY (`mode=ro`). Never
writes the DB. The reset WRITE path is a SEPARATE script (set_servant_reset.py)
that targets the VM LIVE db over `ssh vm`, never the replica.

Findings shape (per row, evidence_json parsed → `evidence` object or null):
  id, created_at, rank_score, dimension, title, description, evidence,
  realized_dollars, n_distinct_trades, confidence, job

Only `handled=0` rows, ranked best-first (rank_score DESC, then newest). The $ is
`realized_dollars` — the engine's DEDUP'd per-distinct-trade Σ, NOT a raw row-sum.

Always emits ONE JSON object to stdout and exits 0 (fail-safe shape on error), so
the route layer never sees a non-zero exit / unparseable output.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Optional

DB = "/home/trevor/trevor/trevor.db"  # symlink → /home/ghost/trevor-replica/trevor.db on WSL

_COLS = [
    "id", "created_at", "rank_score", "dimension", "title", "description",
    "evidence_json", "realized_dollars", "n_distinct_trades", "confidence", "job",
]

FALLBACK = {
    "findings": [],
    "window_start_at": None,
    "last_report_at": None,
    "generated_at": None,
    "open_count": 0,
    "replica_age_seconds": None,
    "replica_mtime": None,
    "error": None,
}


def _replica_age() -> tuple[Optional[int], Optional[str]]:
    """Replica freshness from the published-file mtime (atomic-mv restore stamp)."""
    try:
        target = os.path.realpath(DB)
        st = os.stat(target)
        age = int(datetime.now(timezone.utc).timestamp() - st.st_mtime)
        iso = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        return max(0, age), iso
    except Exception:
        return None, None


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=8.0)
    conn.row_factory = sqlite3.Row
    return conn


def _parse_evidence(raw):
    if not raw:
        return None
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else {"value": v}
    except (json.JSONDecodeError, TypeError):
        return {"raw": str(raw)[:500]}


def do_list() -> dict:
    age, mtime = _replica_age()
    out = {**FALLBACK, "replica_age_seconds": age, "replica_mtime": mtime}
    try:
        conn = _connect()
    except Exception as exc:
        out["error"] = f"{type(exc).__name__}: {exc}"
        return out
    try:
        cols = ", ".join(_COLS)
        rows = conn.execute(
            f"SELECT {cols} FROM servant_findings "
            f"WHERE COALESCE(handled, 0) = 0 "
            f"ORDER BY rank_score DESC, created_at DESC"
        ).fetchall()
        findings = []
        max_created = None
        for r in rows:
            d = {k: r[k] for k in _COLS if k != "evidence_json"}
            d["evidence"] = _parse_evidence(r["evidence_json"])
            findings.append(d)
            ca = r["created_at"]
            if isinstance(ca, (int, float)) and (max_created is None or ca > max_created):
                max_created = ca

        # report-state header (single row id=1; tolerate absence / nulls).
        window_start = last_report = None
        try:
            st = conn.execute(
                "SELECT window_start_at, last_report_at FROM servant_report_state "
                "ORDER BY id LIMIT 1"
            ).fetchone()
            if st is not None:
                window_start = st["window_start_at"]
                last_report = st["last_report_at"]
        except Exception:
            pass  # report-state is non-critical — degrade silently

        out["findings"] = findings
        out["window_start_at"] = window_start
        out["last_report_at"] = last_report
        # generated_at: prefer the engine's last_report_at, else newest finding.
        out["generated_at"] = last_report if last_report is not None else max_created
        out["open_count"] = len(findings)
        out["error"] = None
        return out
    except Exception as exc:
        out["error"] = f"{type(exc).__name__}: {exc}"
        return out
    finally:
        conn.close()


def main() -> int:
    action = sys.argv[1].strip().lower() if len(sys.argv) > 1 else "list"
    if action == "list":
        print(json.dumps(do_list(), default=str))
    else:
        print(json.dumps({**FALLBACK, "error": f"unknown action: {action}"}, default=str))
    return 0


if __name__ == "__main__":
    # OUTER-WRAP: silent-crash visibility (matches sibling helpers)
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
