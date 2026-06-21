#!/usr/bin/env python3
"""query_ai_findings.py — READ-ONLY reader for the AI Analysis Engine findings.

Backs the Health zone AI surfaces (B4 AI engine, Hub read-side):
  - /api/health/ai-findings           (list)  → findings panel + Docs feed
  - /api/health/ai-findings/[id]/recon (recon) → streams a finding's recon_md

Reads the litestream replica (`/home/trevor/trevor/trevor.db`, a symlink to
`/home/ghost/trevor-replica/trevor.db` on WSL) opened READ-ONLY (`mode=ro`).
Never writes the DB. The Analyze-now WRITE path is a SEPARATE script
(set_ai_command.py) that targets the VM LIVE db over `ssh vm`, never the replica.

Actions:
  list           (default) → {"findings": [...], "replica_age_seconds", "replica_mtime", "error": null}
                  findings WHERE status != 'resolved', newest first; recon_md is NOT
                  shipped in the list (it can be large) — only `has_recon` + filename.
  recon <id>     → {"id", "found": bool, "recon_md", "recon_md_filename", "title", "created_at"}

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

# Columns surfaced in the list (recon_md deliberately excluded — fetched per-id).
_LIST_COLS = [
    "id", "created_at", "trigger_type", "severity", "category", "title",
    "summary", "root_cause", "recommendation", "confidence", "evidence_json",
    "status", "model_used", "cost_usd", "tokens_used", "recon_md_filename",
]


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


def do_list() -> dict:
    age, mtime = _replica_age()
    try:
        conn = _connect()
    except Exception as exc:
        return {"findings": [], "replica_age_seconds": age, "replica_mtime": mtime,
                "error": f"{type(exc).__name__}: {exc}"}
    try:
        cols = ", ".join(_LIST_COLS)
        # has_recon computed in SQL so the (potentially large) recon_md never crosses the wire.
        rows = conn.execute(
            f"SELECT {cols}, "
            f"(recon_md IS NOT NULL AND length(recon_md) > 0) AS has_recon "
            f"FROM ai_findings WHERE COALESCE(status,'') != 'resolved' "
            f"ORDER BY created_at DESC"
        ).fetchall()
        findings = []
        for r in rows:
            d = {k: r[k] for k in _LIST_COLS}
            d["has_recon"] = bool(r["has_recon"])
            findings.append(d)
        return {"findings": findings, "replica_age_seconds": age,
                "replica_mtime": mtime, "error": None}
    except Exception as exc:
        return {"findings": [], "replica_age_seconds": age, "replica_mtime": mtime,
                "error": f"{type(exc).__name__}: {exc}"}
    finally:
        conn.close()


def do_recon(raw_id: str) -> dict:
    try:
        fid = int(str(raw_id).strip())
    except (TypeError, ValueError):
        return {"id": None, "found": False, "error": "invalid id"}
    try:
        conn = _connect()
    except Exception as exc:
        return {"id": fid, "found": False, "error": f"{type(exc).__name__}: {exc}"}
    try:
        r = conn.execute(
            "SELECT id, title, created_at, recon_md, recon_md_filename "
            "FROM ai_findings WHERE id = ?",
            (fid,),
        ).fetchone()
        if r is None:
            return {"id": fid, "found": False, "error": "not found"}
        recon_md = r["recon_md"] or ""
        return {
            "id": r["id"],
            "found": True,
            "recon_md": recon_md,
            "recon_md_filename": r["recon_md_filename"],
            "title": r["title"],
            "created_at": r["created_at"],
            "error": None,
        }
    except Exception as exc:
        return {"id": fid, "found": False, "error": f"{type(exc).__name__}: {exc}"}
    finally:
        conn.close()


def main() -> int:
    action = sys.argv[1].strip().lower() if len(sys.argv) > 1 else "list"
    if action == "list":
        print(json.dumps(do_list(), default=str))
    elif action == "recon":
        rid = sys.argv[2] if len(sys.argv) > 2 else ""
        print(json.dumps(do_recon(rid), default=str))
    else:
        print(json.dumps({"error": f"unknown action: {action}"}))
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
