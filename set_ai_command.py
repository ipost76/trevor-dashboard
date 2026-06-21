#!/usr/bin/env python3
"""set_ai_command.py — Hub write surface for the AI Analysis Engine command queue.

Backs the Health zone "Analyze now" button (B4 AI engine, Hub write-side). Mirrors
set_killswitch.py: reads ONE JSON object from stdin, emits ONE JSON object to
stdout, exits with a status code the route maps to HTTP.

⚠️ WRITES THE VM *LIVE* trevor.db, NOT the replica. The bot's AI engine polls the
LIVE `ai_engine_commands` table; the WSL litestream replica is read-only (0444) and
the engine never reads it, so a replica write would be inert. Like the read helpers
(query_memory_daily.py), the write reaches the VM over the read-only-login `ssh vm`
pipe, running `sudo -u trevor python3 -` so the row + any WAL/SHM files are owned by
`trevor` (matching the bot) — a short busy_timeout'd transaction, WAL-safe alongside
the live writer. The command payload is base64-embedded (never the remote shell) and
bound as SQL params (never interpolated).

Usage (called by POST /api/health/ai-findings via runPython with stdin):
    echo '{"command":"analyze_now","params":{...},"author":"ghost"}' | set_ai_command.py

Exit codes:
    0  success (row enqueued)
    1  usage error / bad action / bad JSON
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
ALLOWED_COMMANDS = {"analyze_now"}

# Pure-stdlib program run ON THE VM as `trevor`. INSERTs one row into the LIVE
# ai_engine_commands table. The payload arrives via the base64-embedded PARAMS
# dict — never the remote shell — and is bound as SQL params.
_REMOTE_BODY = r'''
import sqlite3, json as _json
DB = "/home/trevor/trevor/trevor.db"
try:
    con = sqlite3.connect(DB, timeout=10)
    con.execute("PRAGMA busy_timeout=10000")
    cur = con.execute(
        "INSERT INTO ai_engine_commands (command, params, status, created_at) "
        "VALUES (?, ?, 'pending', ?)",
        (PARAMS["command"], PARAMS["params_json"], PARAMS["created_at"]),
    )
    con.commit()
    rid = cur.lastrowid
    con.close()
    print(_json.dumps({"_status": "ok", "id": rid}))
except Exception as e:
    print(_json.dumps({"_status": "error", "detail": f"{type(e).__name__}: {e}"}))
'''


def _emit(payload: dict, code: int = 0) -> NoReturn:
    print(json.dumps(payload, default=str))
    sys.exit(code)


def enqueue(command: str, params: dict, author: str) -> None:
    created_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    # Stamp the author into params so the queued command carries provenance.
    params = {**params, "author": author}
    payload = {
        "command": command,
        "params_json": json.dumps(params, default=str),
        "created_at": created_at,
    }
    b64 = base64.b64encode(json.dumps(payload).encode()).decode()
    program = (
        "import base64, json\n"
        "PARAMS = json.loads(base64.b64decode('" + b64 + "').decode())\n"
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
        "id": data.get("id"),
        "command": command,
        "status": "pending",
        "created_at": created_at,
        "target": "vm_live",
        "note": "enqueued on the VM LIVE ai_engine_commands queue (engine capped until 2026-07-01)",
    }, code=0)


def main() -> None:
    raw = sys.stdin.read() if not sys.stdin.isatty() else (sys.argv[1] if len(sys.argv) > 1 else "")
    if not raw:
        _emit({"ok": False, "error": "missing JSON body on stdin"}, code=1)
    try:
        body = json.loads(raw)
    except json.JSONDecodeError as exc:
        _emit({"ok": False, "error": f"bad JSON: {exc}"}, code=1)

    command = str(body.get("command", "analyze_now")).strip().lower() or "analyze_now"
    if command not in ALLOWED_COMMANDS:
        _emit({"ok": False, "error": f"command must be one of {sorted(ALLOWED_COMMANDS)} (got {command!r})"}, code=1)

    params = body.get("params", {})
    if not isinstance(params, dict):
        _emit({"ok": False, "error": "params must be an object"}, code=1)

    author = str(body.get("author", "ghost")).strip() or "ghost"
    enqueue(command, params, f"hub:{author}")


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
