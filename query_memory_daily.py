#!/usr/bin/env python3
"""Daily memory reader — brain/memory/<date>.md session checkpoint for one date.

RE-SOURCED to the VM (RM-CLOSE-E1). The Hub runs on the WSL box where
brain/memory/ does NOT exist (it lives only on the VM). This helper fetches the
single daily-checkpoint file for <date> over the read-only `ssh vm` pipe (a small
STDLIB-ONLY remote program reads brain/memory/<date>.md). The date is validated
locally and passed base64-embedded (never touches the remote shell). No VM write.

Mirrors query_brain_read.py (single-file VM read) and shares the brain/memory
source with query_memory_entries.py (the MEMORY-tab list reader). Per G1 §0.7
there is NO SQLite memory table — the artifact is a per-day markdown file
(e.g. brain/memory/2026-06-15.md). The litestream replica (a SQLite DB) does NOT
contain this data; ssh vm is the only source.

Usage:
  query_memory_daily.py <YYYY-MM-DD>

Emits one JSON object to stdout, exit 0. Statuses:
  ok        -> {"status":"ok","date":..,"content":..,"size_bytes":..,"modified_at":..}
  not_found -> {"status":"not_found","date":..,"error":..}
  error     -> {"status":"error","date":..,"error":..}   (VM unreachable / too large / read error)
"""
from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

MAX_BYTES = 256 * 1024
DATE_PAT = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SSH_BASE = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", "vm"]

# Pure-stdlib program run ON THE VM (read-only). Reads brain/memory/<date>.md.
# The date arrives via the base64-embedded PARAMS dict — never the remote shell.
_REMOTE_BODY = r'''
import os, json as _json
MEMORY_DIR = "/home/trevor/trevor/brain/memory"
MAX_BYTES = 256 * 1024
date = PARAMS["date"]
p = os.path.join(MEMORY_DIR, date + ".md")
try:
    if not os.path.isfile(p):
        print(_json.dumps({"_status": "not_found"}))
    else:
        st = os.stat(p)
        if st.st_size > MAX_BYTES:
            print(_json.dumps({"_status": "too_large", "size": st.st_size}))
        else:
            with open(p, encoding="utf-8", errors="replace") as f:
                content = f.read()
            print(_json.dumps({"_status": "ok", "content": content, "size": st.st_size, "mtime": int(st.st_mtime)}))
except Exception as e:
    print(_json.dumps({"_status": "error", "detail": f"{type(e).__name__}: {e}"}))
'''


def fetch(date: str) -> dict:
    payload = base64.b64encode(json.dumps({"date": date}).encode()).decode()
    program = (
        "import base64, json\n"
        "PARAMS = json.loads(base64.b64decode('" + payload + "').decode())\n"
        + _REMOTE_BODY
    )
    try:
        proc = subprocess.run(
            SSH_BASE + ["python3", "-"],
            input=program,
            capture_output=True,
            text=True,
            timeout=8,
            env={**os.environ, "HOME": "/home/ghost"},  # runPython sets HOME=/home/trevor
        )
    except subprocess.TimeoutExpired:
        return {"status": "error", "date": date, "error": "VM unreachable: ssh timeout"}
    except Exception as exc:  # pragma: no cover
        return {"status": "error", "date": date, "error": f"VM unreachable: {type(exc).__name__}: {exc}"}
    if proc.returncode != 0 or not proc.stdout.strip():
        return {"status": "error", "date": date, "error": f"VM unreachable: {(proc.stderr or 'ssh failed').strip()[:200]}"}
    try:
        data = json.loads(proc.stdout.strip())
    except json.JSONDecodeError:
        return {"status": "error", "date": date, "error": "VM unreachable: unparseable remote output"}

    status = data.get("_status")
    if status == "not_found":
        return {"status": "not_found", "date": date, "error": f"no memory file for {date}"}
    if status == "too_large":
        return {"status": "error", "date": date, "error": f"file too large for UI: {data.get('size')} bytes (max {MAX_BYTES})"}
    if status != "ok":
        return {"status": "error", "date": date, "error": f"read error: {data.get('detail', 'unknown')}"}

    content = data.get("content", "")
    return {
        "status": "ok",
        "date": date,
        "content": content,
        "size_bytes": data.get("size", len(content.encode("utf-8", "replace"))),
        "modified_at": datetime.fromtimestamp(data.get("mtime", 0), tz=timezone.utc).isoformat(),
    }


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "error": "usage: query_memory_daily.py <YYYY-MM-DD>"}))
        return
    date = sys.argv[1].strip()
    if not DATE_PAT.match(date):
        print(json.dumps({"status": "error", "date": date, "error": "invalid date format"}))
        return
    print(json.dumps(fetch(date)))


if __name__ == "__main__":
    # OUTER-WRAP: silent-crash visibility (matches sibling helpers)
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
