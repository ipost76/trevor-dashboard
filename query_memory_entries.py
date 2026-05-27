#!/usr/bin/env python3
"""Memory journal reader — brain/memory/*.md daily session checkpoints.

Per G1 §0.7: no `memory_journal` SQLite table exists. The actual TREVOR memory
artifact is a per-day markdown file (e.g. brain/memory/2026-04-30.md) holding
last-N exchanges + state metadata.

Usage:
  query_memory_entries.py [limit] [search_query]

Returns most-recent-first list. Search is substring match (case-insensitive)
over the file body.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

MEMORY_DIR = Path("/home/trevor/trevor/brain/memory")
MAX_BYTES = 256 * 1024
DATE_PAT = re.compile(r"^(\d{4}-\d{2}-\d{2})\.md$")
TS_HEADER_PAT = re.compile(r"^# Session Checkpoint — (.+?)$", re.MULTILINE)


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

    if not MEMORY_DIR.exists() or not MEMORY_DIR.is_dir():
        print(json.dumps(out))
        return

    candidates = []
    for p in MEMORY_DIR.glob("*.md"):
        m = DATE_PAT.match(p.name)
        if not m:
            continue
        candidates.append((m.group(1), p))

    # Sort newest-first by date in filename
    candidates.sort(key=lambda t: t[0], reverse=True)

    q_lower = q.lower()
    matched = 0
    entries: list[dict] = []
    for date_str, p in candidates:
        try:
            stat = p.stat()
            if stat.st_size > MAX_BYTES:
                content = p.read_text(encoding="utf-8", errors="replace")[:MAX_BYTES]
            else:
                content = p.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue

        if q_lower and q_lower not in content.lower():
            continue
        matched += 1
        if len(entries) >= limit:
            continue

        # Pull the embedded ISO timestamp if present, else fall back to mtime.
        m_ts = TS_HEADER_PAT.search(content)
        ts = m_ts.group(1).strip() if m_ts else datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
        entries.append({
            "id": date_str,
            "ts": ts,
            "tag": "session-checkpoint",
            "content": content,
            "size_bytes": stat.st_size,
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
