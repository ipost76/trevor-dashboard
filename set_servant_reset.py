#!/usr/bin/env python3
"""set_servant_reset.py — Hub reset surface for the SERVANT edge-hunter (B5).

Backs the SERVANT zone "Reset report" button. Mirrors set_ai_command.py: emits ONE
JSON object to stdout and exits with a status code the route maps to HTTP.

⚠️ WRITES THE VM *LIVE* trevor.db, NOT the replica. The WSL litestream replica is
read-only (0444) and the engine never reads it, so a replica write would be inert.
Like set_ai_command.py, the write reaches the VM over the read-only-login `ssh vm`
pipe, running `sudo -u trevor python3 -` so any WAL/SHM files are owned by `trevor`
(matching the bot) — a short busy_timeout'd transaction, WAL-safe alongside the
live writer.

THE WRITE IS ADDITIVE AND SAFE EVEN IF MIS-TRIGGERED:
  • `UPDATE servant_findings SET handled=1 WHERE handled=0` — marks open edges
    handled. Idempotent (re-running affects 0 rows). NEVER DELETEs a row.
  • stamps servant_report_state.last_handled_at / updated_at (best-effort).
  • NEVER touches servant_experiments (the B3 "memory" — what SERVANT learned).
This honors the contract documented in observatory/tasks/servant.py: "a reset sets
`handled=1`, NEVER `DELETE`". When B4 ships a canonical `reset_report()`, swap the
inlined UPDATE below for a call to it (the engine then formally owns the write).

Usage (called by POST /api/servant/reset via runPythonResult; no body required):
    set_servant_reset.py            # or: echo '{"author":"ghost"}' | set_servant_reset.py

Exit codes:
    0  success (rows marked handled; count in payload)
    2  backend / VM-unreachable / DB error
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from typing import NoReturn

SSH_BASE = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", "vm"]

# Pure-stdlib program run ON THE VM as `trevor`. Additive: flips handled=0 → 1 for
# open findings and stamps the report-state. Reads no SERVANT secret; the only
# embedded value (the stamp epoch) is base64'd in via META, never the remote shell.
#
# RR2 C-7 (2026-06-27): this ssh-to-live mutation now writes a change_log audit
# row in the SAME transaction (additive, best-effort, fail-open). The audit INSERT
# is wrapped so an audit failure can NEVER abort the reset — the mutation stays
# byte-identical; only an audit row is added.
_REMOTE_BODY = r'''
import sqlite3, json as _json
DB = "/home/trevor/trevor/trevor.db"
try:
    con = sqlite3.connect(DB, timeout=10)
    con.execute("PRAGMA busy_timeout=10000")
    cur = con.execute("UPDATE servant_findings SET handled=1 WHERE COALESCE(handled,0)=0")
    n = cur.rowcount
    # Best-effort: stamp the singleton report-state row (never fatal if absent).
    try:
        con.execute(
            "UPDATE servant_report_state SET last_handled_at=?, updated_at=? "
            "WHERE id=(SELECT id FROM servant_report_state ORDER BY id LIMIT 1)",
            (META["now"], META["now"]),
        )
    except Exception:
        pass
    # C-7 audit: additive change_log row in the same txn. Best-effort — an audit
    # failure must not lose the reset (fail-open per the audit doctrine).
    try:
        con.execute(
            "INSERT INTO change_log "
            "(table_name, key, old_value, new_value, actor, source_type, session_id, notes) "
            "VALUES ('servant_findings', 'handled', '0', '1', ?, 'UI', ?, ?)",
            (META["author"], META["author"],
             "SERVANT reset: marked %d open findings handled=1 via Hub (ssh-to-live)" % n),
        )
    except Exception:
        pass
    con.commit()
    con.close()
    print(_json.dumps({"_status": "ok", "handled": n}))
except Exception as e:
    print(_json.dumps({"_status": "error", "detail": f"{type(e).__name__}: {e}"}))
'''


def _emit(payload: dict, code: int = 0) -> NoReturn:
    print(json.dumps(payload, default=str))
    sys.exit(code)


def reset(author: str) -> None:
    now = int(datetime.now(timezone.utc).timestamp())
    meta = {"now": now, "author": author}
    b64 = base64.b64encode(json.dumps(meta).encode()).decode()
    program = (
        "import base64, json\n"
        "META = json.loads(base64.b64decode('" + b64 + "').decode())\n"
        + _REMOTE_BODY
    )
    try:
        proc = subprocess.run(
            SSH_BASE + ["sudo", "-n", "-u", "trevor", "python3", "-"],
            input=program,
            capture_output=True,
            text=True,
            timeout=12,
            env={**os.environ, "HOME": "/home/ghost"},  # runPython sets HOME=/home/trevor
        )
    except subprocess.TimeoutExpired:
        _emit({"ok": False, "error": "VM unreachable: ssh timeout"}, code=2)
    except Exception as exc:  # pragma: no cover
        _emit({"ok": False, "error": f"VM unreachable: {type(exc).__name__}: {exc}"}, code=2)

    if proc.returncode != 0 or not proc.stdout.strip():
        _emit({"ok": False, "error": f"VM error: {(proc.stderr or 'ssh failed').strip()[:200]}"}, code=2)
    try:
        data = json.loads(proc.stdout.strip())
    except json.JSONDecodeError:
        _emit({"ok": False, "error": "VM error: unparseable remote output"}, code=2)

    if data.get("_status") != "ok":
        _emit({"ok": False, "error": f"DB error: {data.get('detail', 'unknown')}"}, code=2)

    _emit({
        "ok": True,
        "handled": data.get("handled", 0),
        "target": "vm_live",
        "note": "marked open SERVANT findings handled=1 on the VM LIVE db (additive; "
                "never deleted, servant_experiments untouched)",
    }, code=0)


def main() -> None:
    # Body is optional — only `author` is read (for provenance); no required input.
    author = "ghost"
    raw = ""
    if not sys.stdin.isatty():
        raw = sys.stdin.read()
    elif len(sys.argv) > 1:
        raw = sys.argv[1]
    if raw.strip():
        try:
            body = json.loads(raw)
            if isinstance(body, dict):
                author = str(body.get("author", "ghost")).strip() or "ghost"
        except json.JSONDecodeError:
            pass  # ignore a malformed optional body; reset has no required params
    reset(f"hub:{author}")


if __name__ == "__main__":
    # OUTER-WRAP: silent-crash visibility (matches sibling helpers)
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(2)
