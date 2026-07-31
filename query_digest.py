#!/usr/bin/env python3
"""query_digest.py — Hub Activity/Digest feed backend [B7].

Backs GET /api/health/digests (list) and /api/health/digests/<date> (detail),
the per-day nightly-digest cards on /health?tab=activity ("Digest" sub-tab).

The nightly digest is BUILT ON THE VM (B1-B6) and written to the `digest`
table in the live trevor.db; litestream replicates it here. This script only
ever READS the replica.

READ-ONLY (`mode=ro`). Never writes any DB. Mirrors query_loop_health.py's
replica-open + fail-safe main() shape and query_activity.py's `_table_exists`
guard (the replica can be mid-restore, so a table may legitimately be absent).

Modes (argv):
    query_digest.py list [limit]        -> card-preview fields, newest first
    query_digest.py detail <YYYY-MM-DD> -> body_md + metrics_json for one day

🚨 NULL is preserved as JSON null, NEVER coerced to 0. The digest builder
deliberately nulls values it could not verify (B4), and the feed renders those
as UNKNOWN. Coercing a null to 0 here would fabricate a number the bot
explicitly refused to assert.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Any, Optional

# Canonical WSL replica path. `runPython` passes process.env through, and
# .env.local sets TREVOR_DB_PATH, so the env value is the effective one; the
# fallback is the canonical path (NOT the /home/trevor/trevor symlink shim,
# which hides which box's DB you hold — CLAUDE.md Law 0).
DB = os.environ.get("TREVOR_DB_PATH", "/home/ghost/trevor-replica/trevor.db")

DEFAULT_LIMIT = 60
MAX_LIMIT = 365

# Card-preview columns. Deliberately excludes body_md (8 KB+ per row) so the
# list endpoint stays fast — the full document is fetched only on expand.
PREVIEW_COLS = (
    "digest_date",
    "generated_at",
    "headline_pnl_usd",
    "equity_usd",
    "equity_delta_1d",
    "trades_closed_24h",
    "commits_24h",
    "errors_24h",
    "config_changes_24h",
    "top_severity",
    "level",
    "prior_digest_age_h",
    "schema_version",
)


def _replica_age() -> tuple[Optional[int], Optional[str]]:
    """Best-effort mtime/age of the replica file (freshness badge)."""
    try:
        mtime = os.path.getmtime(DB)
        dt = datetime.fromtimestamp(mtime, tz=timezone.utc)
        age = int((datetime.now(tz=timezone.utc) - dt).total_seconds())
        return max(0, age), dt.isoformat().replace("+00:00", "Z")
    except Exception:
        return None, None


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    try:
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).fetchone()
        return row is not None
    except Exception:
        return False


def _fail(payload: dict[str, Any], exc: BaseException | None = None) -> int:
    """Print a fail-safe JSON shape and exit 0 so the route never sees a throw."""
    age, mtime = _replica_age()
    payload.setdefault("replica_age_seconds", age)
    payload.setdefault("replica_mtime", mtime)
    if exc is not None:
        payload["error"] = f"{type(exc).__name__}: {exc}"
    print(json.dumps(payload, default=str))
    return 0


def _open() -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=8.0)
    conn.row_factory = sqlite3.Row
    return conn


def _list(limit: int) -> int:
    base: dict[str, Any] = {
        "digests": [],
        "total": 0,
        "returned": 0,
        "limit": limit,
        "table_present": False,
    }
    try:
        conn = _open()
    except Exception as exc:
        return _fail(dict(base), exc)

    try:
        if not _table_exists(conn, "digest"):
            # Replica mid-restore, or the VM digest builder has not shipped a
            # row yet. An absent table is a legitimate empty state, not an error.
            conn.close()
            return _fail(dict(base))

        total = conn.execute("SELECT COUNT(*) FROM digest").fetchone()[0]
        rows = conn.execute(
            f"SELECT {', '.join(PREVIEW_COLS)} FROM digest "
            "ORDER BY digest_date DESC LIMIT ?",
            (limit,),
        ).fetchall()
        conn.close()
    except Exception as exc:
        try:
            conn.close()
        except Exception:
            pass
        return _fail(dict(base), exc)

    # dict(row) preserves SQL NULL as Python None -> JSON null. Do not coerce.
    digests = [dict(r) for r in rows]
    age, mtime = _replica_age()
    print(
        json.dumps(
            {
                "digests": digests,
                "total": total,
                "returned": len(digests),
                "limit": limit,
                "table_present": True,
                "replica_age_seconds": age,
                "replica_mtime": mtime,
            },
            default=str,
        )
    )
    return 0


def _detail(digest_date: str) -> int:
    base: dict[str, Any] = {
        "found": False,
        "digest_date": digest_date,
        "body_md": None,
        "metrics": None,
        "table_present": False,
    }
    try:
        conn = _open()
    except Exception as exc:
        return _fail(dict(base), exc)

    try:
        if not _table_exists(conn, "digest"):
            conn.close()
            return _fail(dict(base))

        row = conn.execute(
            "SELECT digest_date, generated_at, body_md, metrics_json, "
            "top_severity, level, schema_version "
            "FROM digest WHERE digest_date = ?",
            (digest_date,),
        ).fetchone()
        conn.close()
    except Exception as exc:
        try:
            conn.close()
        except Exception:
            pass
        return _fail(dict(base), exc)

    if row is None:
        base["table_present"] = True
        return _fail(dict(base))

    rec = dict(row)
    raw_metrics = rec.pop("metrics_json", None)
    metrics: Any = None
    if raw_metrics:
        try:
            metrics = json.loads(raw_metrics)
        except Exception:
            # Unparseable metrics must not sink the whole detail read — the
            # body_md is what the user actually asked for.
            metrics = None

    age, mtime = _replica_age()
    print(
        json.dumps(
            {
                "found": True,
                "table_present": True,
                **rec,
                "metrics": metrics,
                "replica_age_seconds": age,
                "replica_mtime": mtime,
            },
            default=str,
        )
    )
    return 0


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "list"

    if mode == "detail":
        digest_date = sys.argv[2] if len(sys.argv) > 2 else ""
        if not digest_date:
            return _fail(
                {
                    "found": False,
                    "digest_date": "",
                    "body_md": None,
                    "metrics": None,
                    "table_present": False,
                    "error": "usage: query_digest.py detail <YYYY-MM-DD>",
                }
            )
        return _detail(digest_date)

    try:
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_LIMIT
    except (TypeError, ValueError):
        limit = DEFAULT_LIMIT
    limit = max(1, min(limit, MAX_LIMIT))
    return _list(limit)


if __name__ == "__main__":
    # OUTER-WRAP: silent-crash visibility (mirrors query_loop_health.py).
    import traceback as _tb_wrap, sys as _sys_wrap

    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
