#!/usr/bin/env python3
"""Write content to a NON-SACRED brain file.

Sacred files ALWAYS rejected. HUB_BRAIN_EDIT_ENABLED gate also enforced.
Atomic write + timestamped .bak + brain_edit_audit row.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

BRAIN_DIR = Path("/home/trevor/trevor/brain")
DB = "/home/trevor/trevor/trevor.db"
SACRED_NAMES = frozenset(("IDENTITY.md", "BRAIN.md", "SOUL.md", "AGENTS.md"))
MAX_BYTES = 256 * 1024


def is_edit_enabled() -> bool:
    try:
        with sqlite3.connect(DB, timeout=10) as conn:
            row = conn.execute(
                "SELECT value FROM auto_config WHERE key='HUB_BRAIN_EDIT_ENABLED'"
            ).fetchone()
        return bool(row and str(row[0]).lower() == "true")
    except Exception:
        return False


def ensure_audit_table(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS brain_edit_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            author TEXT NOT NULL,
            sha_before TEXT,
            sha_after TEXT,
            size_before INTEGER,
            size_after INTEGER,
            backup_path TEXT,
            edited_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.commit()


def main() -> None:
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: write_brain_file.py <filename> <author>"}), file=sys.stderr)
        sys.exit(2)

    raw = sys.argv[1]
    author = sys.argv[2]
    name = Path(raw).name
    if name != raw or "/" in raw or ".." in raw or not name.endswith(".md") or ".backup" in name:
        print(json.dumps({"error": "invalid filename"}), file=sys.stderr)
        sys.exit(2)
    if name in SACRED_NAMES:
        print(json.dumps({"error": f"sacred file — write rejected: {name}"}), file=sys.stderr)
        sys.exit(3)
    if not is_edit_enabled():
        print(json.dumps({"error": "HUB_BRAIN_EDIT_ENABLED is false"}), file=sys.stderr)
        sys.exit(3)

    p = BRAIN_DIR / name
    if not p.exists():
        print(json.dumps({"error": f"file not found: {name}"}), file=sys.stderr)
        sys.exit(2)

    new_content = sys.stdin.read()
    if len(new_content.encode("utf-8")) > MAX_BYTES:
        print(json.dumps({"error": "content exceeds max bytes"}), file=sys.stderr)
        sys.exit(2)

    try:
        old_content = p.read_text(encoding="utf-8")
        sha_before = hashlib.sha256(old_content.encode("utf-8")).hexdigest()
        sha_after = hashlib.sha256(new_content.encode("utf-8")).hexdigest()
        if sha_before == sha_after:
            print(json.dumps({"ok": True, "no_change": True}))
            return

        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_path = p.with_suffix(p.suffix + f".{ts}.bak")
        backup_path.write_text(old_content, encoding="utf-8")

        tmp = p.with_suffix(p.suffix + ".tmp")
        tmp.write_text(new_content, encoding="utf-8")
        os.replace(tmp, p)

        with sqlite3.connect(DB, timeout=10) as conn:
            ensure_audit_table(conn)
            cur = conn.execute(
                "INSERT INTO brain_edit_audit "
                "(filename, author, sha_before, sha_after, size_before, size_after, backup_path) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (name, author, sha_before, sha_after, len(old_content), len(new_content), str(backup_path)),
            )
            conn.commit()
            audit_id = cur.lastrowid

        old_lines = old_content.splitlines()
        new_lines = new_content.splitlines()
        lines_changed = sum(1 for a, b in zip(old_lines, new_lines) if a != b)
        lines_changed += abs(len(new_lines) - len(old_lines))

        print(json.dumps({
            "ok": True,
            "name": name,
            "size_before": len(old_content),
            "size_after": len(new_content),
            "lines_changed_estimate": lines_changed,
            "backup_path": str(backup_path),
            "audit_id": audit_id,
            "no_change": False,
        }))
    except Exception as exc:
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
