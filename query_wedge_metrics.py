#!/usr/bin/env python3
"""Wedge-metrics reader — the bot's loop-freeze regression signal (Wedge-Rate [B2]).

Reads the VM file logs/wedge_metrics.json (produced by the companion VM-side [B1]
job) over the read-only `ssh vm` pipe and returns it verbatim. The Hub runs on the
WSL box; wedge_metrics.json lives ONLY on the VM at /home/trevor/trevor/logs/ and
is NOT in the litestream replica and NOT copied by trevor-tailsync (which syncs
trevor.db only) — so `ssh vm` is the only source.

Mirrors query_memory_daily.py (single-file VM read via `ssh vm python3 -`, a small
STDLIB-ONLY remote program). Read-only: never writes the VM, never touches the DB.

This helper ONLY consumes the [B1] contract — it does NOT parse bot logs. The remote
program hands back the raw file text; the JSON is parsed locally so a mid-write /
malformed file becomes a clean "error", distinct from an absent file ("no_data").

Usage:
  query_wedge_metrics.py

Emits one JSON object to stdout, exit 0. Statuses:
  ok      -> {"status":"ok","metrics":{...the wedge_metrics.json contract...}}
  no_data -> {"status":"no_data"}                        (B1 not deployed yet / file absent)
  error   -> {"status":"error","error":...}              (VM unreachable / parse error / too large)
"""
from __future__ import annotations

import json
import os
import subprocess

# Absolute VM path — /home/trevor/trevor is the bot working dir (sibling of the
# brain/memory files query_memory_daily.py reads). B1 writes exactly here.
VM_PATH = "/home/trevor/trevor/logs/wedge_metrics.json"
MAX_BYTES = 512 * 1024
SSH_BASE = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", "vm"]

# Pure-stdlib program run ON THE VM (read-only). Returns the raw file text; the
# JSON is validated LOCALLY so absent-vs-malformed stay distinct.
_REMOTE_BODY = r'''
import os, json as _json
PATH = "%s"
MAX_BYTES = %d
try:
    if not os.path.isfile(PATH):
        print(_json.dumps({"_status": "no_data"}))
    else:
        st = os.stat(PATH)
        if st.st_size > MAX_BYTES:
            print(_json.dumps({"_status": "too_large", "size": st.st_size}))
        else:
            with open(PATH, encoding="utf-8", errors="replace") as f:
                content = f.read()
            print(_json.dumps({"_status": "ok", "content": content, "size": st.st_size, "mtime": int(st.st_mtime)}))
except Exception as e:
    print(_json.dumps({"_status": "error", "detail": f"{type(e).__name__}: {e}"}))
''' % (VM_PATH, MAX_BYTES)


def fetch() -> dict:
    try:
        proc = subprocess.run(
            SSH_BASE + ["python3", "-"],
            input=_REMOTE_BODY,
            capture_output=True,
            text=True,
            timeout=8,
            env={**os.environ, "HOME": "/home/ghost"},  # defensive only: ssh resolves ~/.ssh from the UID (getpwuid), not $HOME [RF3T2-B8]
        )
    except subprocess.TimeoutExpired:
        return {"status": "error", "error": "VM unreachable: ssh timeout"}
    except Exception as exc:  # pragma: no cover
        return {"status": "error", "error": f"VM unreachable: {type(exc).__name__}: {exc}"}
    if proc.returncode != 0 or not proc.stdout.strip():
        return {"status": "error", "error": f"VM unreachable: {(proc.stderr or 'ssh failed').strip()[:200]}"}
    try:
        remote = json.loads(proc.stdout.strip())
    except json.JSONDecodeError:
        return {"status": "error", "error": "VM unreachable: unparseable remote output"}

    status = remote.get("_status")
    if status == "no_data":
        return {"status": "no_data"}
    if status == "too_large":
        return {"status": "error", "error": f"file too large: {remote.get('size')} bytes (max {MAX_BYTES})"}
    if status != "ok":
        return {"status": "error", "error": f"read error: {remote.get('detail', 'unknown')}"}

    # File present — validate it parses as JSON (a mid-write file is malformed).
    content = remote.get("content", "")
    try:
        metrics = json.loads(content)
    except json.JSONDecodeError as exc:
        return {"status": "error", "error": f"parse error: {exc}"}
    if not isinstance(metrics, dict):
        return {"status": "error", "error": "parse error: top-level JSON is not an object"}
    return {"status": "ok", "metrics": metrics}


def main() -> None:
    print(json.dumps(fetch()))


if __name__ == "__main__":
    # OUTER-WRAP: silent-crash visibility (matches sibling helpers)
    import traceback as _tb_wrap
    import sys as _sys_wrap
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
