#!/usr/bin/env python3
"""Memory journal reader — brain/memory/*.md daily session checkpoints.

RE-SOURCED to the VM (RM-MEM-A3, F-17). The Hub runs on the WSL box where
brain/memory/ does NOT exist (it lives only on the VM). This helper now fetches the
daily-checkpoint files over the read-only `ssh vm` pipe (a small STDLIB-ONLY remote
program lists + reads brain/memory/*.md), then does ALL filtering/parsing LOCALLY —
so the user search query never crosses the pipe (injection-safe). No VM write.

Per G1 §0.7: no `memory_journal` SQLite table exists. The actual TREVOR memory
artifact is a per-day markdown file (e.g. brain/memory/2026-04-30.md) holding
last-N exchanges + state metadata.

Usage:
  query_memory_entries.py [limit] [search_query]

Returns most-recent-first list. Search is substring match (case-insensitive) over
the file body, applied locally. Distinguishes "VM unreachable" (error set) from a
genuine empty result (data_available:false, no error).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

MAX_BYTES = 256 * 1024
TS_HEADER_PAT = re.compile(r"^# Session Checkpoint — (.+?)$", re.MULTILINE)
SSH_BASE = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", "vm"]

# Pure-stdlib program run ON THE VM (read-only). Lists brain/memory/YYYY-MM-DD.md and
# returns [date_str, content, size_bytes, mtime_epoch] for each. No user input here.
_REMOTE = r'''
import os, re, json
MEMORY_DIR = "/home/trevor/trevor/brain/memory"
MAX_BYTES = 256 * 1024
DATE_PAT = re.compile(r"^(\d{4}-\d{2}-\d{2})\.md$")
try:
    names = os.listdir(MEMORY_DIR)
except Exception as e:
    print(json.dumps({"_remote_error": f"{type(e).__name__}: {e}"}))
    raise SystemExit(0)
out = []
for n in names:
    m = DATE_PAT.match(n)
    if not m:
        continue
    p = os.path.join(MEMORY_DIR, n)
    try:
        st = os.stat(p)
        with open(p, encoding="utf-8", errors="replace") as f:
            content = f.read(MAX_BYTES)
    except Exception:
        continue
    out.append([m.group(1), content, st.st_size, int(st.st_mtime)])
print(json.dumps({"files": out}))
'''


def fetch_files() -> tuple[list, str | None]:
    """Return (files, error). files = [[date, content, size, mtime], ...]."""
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
        return [], f"brain/memory read error: {data['_remote_error']}"
    return data.get("files", []), None


def main() -> None:
    limit = 50
    q = ""
    if len(sys.argv) >= 2:
        try:
            limit = max(1, min(200, int(sys.argv[1])))
        except ValueError:
            pass
    if len(sys.argv) >= 3:
        q = sys.argv[2].strip()

    out = {"entries": [], "total": 0, "data_available": False, "filter": q}

    files, error = fetch_files()
    if error is not None:
        out["error"] = error
        print(json.dumps(out))
        return

    # newest-first by date in filename
    files.sort(key=lambda t: t[0], reverse=True)

    q_lower = q.lower()
    matched = 0
    entries: list[dict] = []
    for date_str, content, size_bytes, mtime in files:
        if q_lower and q_lower not in content.lower():
            continue
        matched += 1
        if len(entries) >= limit:
            continue
        m_ts = TS_HEADER_PAT.search(content)
        ts = m_ts.group(1).strip() if m_ts else datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
        entries.append({
            "id": date_str,
            "ts": ts,
            "tag": "session-checkpoint",
            "content": content,
            "size_bytes": size_bytes,
        })

    out["entries"] = entries
    out["total"] = matched
    out["data_available"] = matched > 0
    print(json.dumps(out))


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
