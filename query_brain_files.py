#!/usr/bin/env python3
"""List files in /home/trevor/trevor/brain/ with sacred-status flags.

Top-level brain/*.md only. Excludes .backup* clutter (Ghost-approved G1 §1.1).
Sacred files = IDENTITY/BRAIN/SOUL/AGENTS — never editable.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

BRAIN_DIR = Path("/home/trevor/trevor/brain")
DB = "/home/trevor/trevor/trevor.db"
SACRED_NAMES = frozenset(("IDENTITY.md", "BRAIN.md", "SOUL.md", "AGENTS.md"))


def is_edit_enabled() -> bool:
    try:
        with sqlite3.connect(DB, timeout=10) as conn:
            row = conn.execute(
                "SELECT value FROM auto_config WHERE key='HUB_BRAIN_EDIT_ENABLED'"
            ).fetchone()
        return bool(row and str(row[0]).lower() == "true")
    except Exception:
        return False


def main() -> None:
    edit_enabled = is_edit_enabled()
    files = []
    if BRAIN_DIR.exists():
        for p in sorted(BRAIN_DIR.glob("*.md")):
            if ".backup" in p.name:
                continue
            try:
                stat = p.stat()
                is_sacred = p.name in SACRED_NAMES
                files.append({
                    "path": f"brain/{p.name}",
                    "name": p.name,
                    "size_bytes": stat.st_size,
                    "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                    "is_sacred": is_sacred,
                    "is_editable": (not is_sacred) and edit_enabled,
                })
            except Exception:
                continue

    sacred_count = sum(1 for f in files if f["is_sacred"])
    print(json.dumps({
        "files": files,
        "edit_enabled": edit_enabled,
        "sacred_count": sacred_count,
        "non_sacred_count": len(files) - sacred_count,
    }))


if __name__ == "__main__":
    main()
