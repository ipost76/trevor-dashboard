#!/usr/bin/env python3
"""Read a brain/ file. Sacred read-OK; write blocked elsewhere."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

BRAIN_DIR = Path("/home/trevor/trevor/brain")
SACRED_NAMES = frozenset(("IDENTITY.md", "BRAIN.md", "SOUL.md", "AGENTS.md"))
MAX_BYTES = 256 * 1024


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: query_brain_read.py <filename>"}), file=sys.stderr)
        sys.exit(2)

    raw = sys.argv[1]
    name = Path(raw).name
    if name != raw or "/" in raw or ".." in raw or not name.endswith(".md") or ".backup" in name:
        print(json.dumps({"error": "invalid filename"}), file=sys.stderr)
        sys.exit(2)

    p = BRAIN_DIR / name
    if not p.exists() or not p.is_file():
        print(json.dumps({"error": f"file not found: {name}"}), file=sys.stderr)
        sys.exit(2)

    try:
        stat = p.stat()
        if stat.st_size > MAX_BYTES:
            print(json.dumps({"error": f"file too large for UI: {stat.st_size} bytes (max {MAX_BYTES})"}), file=sys.stderr)
            sys.exit(2)
        content = p.read_text(encoding="utf-8", errors="replace")
        print(json.dumps({
            "name": name,
            "path": f"brain/{name}",
            "content": content,
            "is_sacred": name in SACRED_NAMES,
            "size_bytes": stat.st_size,
            "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            "lines": content.count("\n") + 1,
        }))
    except Exception as exc:
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
