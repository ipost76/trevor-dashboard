#!/usr/bin/env python3
"""Read a brain/ file. Sacred read-OK; write blocked elsewhere.

RE-SOURCED to the VM (RM-MEM-A3, F-17). brain/ lives only on the VM, so the file
content is fetched over the read-only `ssh vm` pipe (stdlib-only remote read). The
filename is validated locally and passed base64-embedded (never touches the remote
shell). No VM write. Emits one JSON object to stdout, exit 0 (errors as {"error":...}).
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SACRED_NAMES = frozenset(("IDENTITY.md", "BRAIN.md", "SOUL.md", "AGENTS.md"))
MAX_BYTES = 256 * 1024
SSH_BASE = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", "vm"]

_REMOTE_BODY = r'''
import os, json as _json
BRAIN_DIR = "/home/trevor/trevor/brain"
MAX_BYTES = 256 * 1024
name = PARAMS["name"]
p = os.path.join(BRAIN_DIR, name)
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


def fetch(name: str) -> dict:
    payload = base64.b64encode(json.dumps({"name": name}).encode()).decode()
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
            env={**os.environ, "HOME": "/home/ghost"},
        )
    except subprocess.TimeoutExpired:
        return {"error": "VM unreachable: ssh timeout"}
    except Exception as exc:  # pragma: no cover
        return {"error": f"VM unreachable: {type(exc).__name__}: {exc}"}
    if proc.returncode != 0 or not proc.stdout.strip():
        return {"error": f"VM unreachable: {(proc.stderr or 'ssh failed').strip()[:200]}"}
    try:
        data = json.loads(proc.stdout.strip())
    except json.JSONDecodeError:
        return {"error": "VM unreachable: unparseable remote output"}

    status = data.get("_status")
    if status == "not_found":
        return {"error": f"file not found: {name}"}
    if status == "too_large":
        return {"error": f"file too large for UI: {data.get('size')} bytes (max {MAX_BYTES})"}
    if status != "ok":
        return {"error": f"read error: {data.get('detail', 'unknown')}"}

    content = data.get("content", "")
    return {
        "name": name,
        "path": f"brain/{name}",
        "content": content,
        "is_sacred": name in SACRED_NAMES,
        "size_bytes": data.get("size", len(content.encode("utf-8", "replace"))),
        "modified_at": datetime.fromtimestamp(data.get("mtime", 0), tz=timezone.utc).isoformat(),
        "lines": content.count("\n") + 1,
    }


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: query_brain_read.py <filename>"}))
        return
    raw = sys.argv[1]
    name = Path(raw).name
    if name != raw or "/" in raw or ".." in raw or not name.endswith(".md") or ".backup" in name:
        print(json.dumps({"error": "invalid filename"}))
        return
    print(json.dumps(fetch(name)))


if __name__ == "__main__":
    # OUTER-WRAP: 2026-05-27 (silent-crash visibility)
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        main()

    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
