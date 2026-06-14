#!/usr/bin/env python3
"""List files in /home/trevor/trevor/brain/ with sacred-status flags.

RE-SOURCED to the VM (RM-MEM-A3, F-17). The Hub runs on the WSL box where brain/
does NOT exist (it lives only on the VM). The brain *file listing* is fetched over
the read-only `ssh vm` pipe; the `HUB_BRAIN_EDIT_ENABLED` flag is still read LOCALLY
from the litestream replica (trevor.db symlink) — that part already worked on WSL.
No VM write.

Top-level brain/*.md only. Excludes .backup* clutter (Ghost-approved G1 §1.1).
Sacred files = IDENTITY/BRAIN/SOUL/AGENTS — never editable.
Distinguishes "VM unreachable" (error set) from a genuine empty dir.
"""
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
from datetime import datetime, timezone

DB = "/home/trevor/trevor/trevor.db"  # symlink -> litestream replica on WSL
SACRED_NAMES = frozenset(("IDENTITY.md", "BRAIN.md", "SOUL.md", "AGENTS.md"))
SSH_BASE = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", "vm"]

# Pure-stdlib program run ON THE VM (read-only). Lists brain/*.md (excl .backup) and
# returns [name, size_bytes, mtime_epoch] for each. No user input here.
_REMOTE = r'''
import os, json
BRAIN_DIR = "/home/trevor/trevor/brain"
try:
    names = os.listdir(BRAIN_DIR)
except Exception as e:
    print(json.dumps({"_remote_error": f"{type(e).__name__}: {e}"}))
    raise SystemExit(0)
out = []
for n in sorted(names):
    if not n.endswith(".md") or ".backup" in n:
        continue
    p = os.path.join(BRAIN_DIR, n)
    if not os.path.isfile(p):
        continue
    try:
        st = os.stat(p)
    except Exception:
        continue
    out.append([n, st.st_size, int(st.st_mtime)])
print(json.dumps({"files": out}))
'''


def is_edit_enabled() -> bool:
    try:
        with sqlite3.connect(DB, timeout=10) as conn:
            row = conn.execute(
                "SELECT value FROM auto_config WHERE key='HUB_BRAIN_EDIT_ENABLED'"
            ).fetchone()
        return bool(row and str(row[0]).lower() == "true")
    except Exception:
        return False


def fetch_files() -> tuple[list, str | None]:
    try:
        proc = subprocess.run(
            SSH_BASE + ["python3", "-"],
            input=_REMOTE,
            capture_output=True,
            text=True,
            timeout=8,
            env={**os.environ, "HOME": "/home/ghost"},  # runPython sets HOME=/home/trevor
        )
    except subprocess.TimeoutExpired:
        return [], "VM unreachable: ssh timeout"
    except Exception as exc:  # pragma: no cover
        return [], f"VM unreachable: {type(exc).__name__}: {exc}"
    if proc.returncode != 0 or not proc.stdout.strip():
        return [], f"VM unreachable: {(proc.stderr or 'ssh failed').strip()[:200]}"
    try:
        data = json.loads(proc.stdout.strip())
    except json.JSONDecodeError:
        return [], "VM unreachable: unparseable remote output"
    if "_remote_error" in data:
        return [], f"brain read error: {data['_remote_error']}"
    return data.get("files", []), None


def main() -> None:
    edit_enabled = is_edit_enabled()
    remote_files, error = fetch_files()

    if error is not None:
        print(json.dumps({
            "files": [],
            "edit_enabled": edit_enabled,
            "sacred_count": 0,
            "non_sacred_count": 0,
            "error": error,
        }))
        return

    files = []
    for name, size_bytes, mtime in remote_files:
        is_sacred = name in SACRED_NAMES
        files.append({
            "path": f"brain/{name}",
            "name": name,
            "size_bytes": size_bytes,
            "modified_at": datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat(),
            "is_sacred": is_sacred,
            "is_editable": (not is_sacred) and edit_enabled,
        })

    sacred_count = sum(1 for f in files if f["is_sacred"])
    print(json.dumps({
        "files": files,
        "edit_enabled": edit_enabled,
        "sacred_count": sacred_count,
        "non_sacred_count": len(files) - sacred_count,
    }))


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
