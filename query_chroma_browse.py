#!/usr/bin/env python3
"""ChromaDB browser: list / peek / search — RE-SOURCED to the VM (RM-MEM-A3, F-17).

The Hub runs on the WSL box where the ChromaDB persist dir does NOT exist (it lives
only on the VM at /home/trevor/trevor/vectordb) and `chromadb` is not even installed.
So this helper no longer reads a local path / instantiates a PersistentClient. Instead
it runs a small STDLIB-ONLY python program on the VM over the read-only `ssh vm` pipe,
querying chroma.sqlite3 with `mode=ro` (NO write, NO PersistentClient — honoring the
read-only contract; never contends with the bot's live client on the 2-vCPU VM).

Modes (CLI contract unchanged):
  list                                 — collections + counts
  peek <collection> [limit]            — sample documents
  search <collection> <query> [limit]  — KEYWORD search (FTS5 trigram; not semantic)

Caps: max limit 25; embeddings never returned.
Distinguishes "VM unreachable" (vm_unreachable:true + error) from a genuine empty list.
"""
from __future__ import annotations

import base64
import json
import subprocess
import sys
from typing import Any

VECTORDB_SQLITE = "/home/trevor/trevor/vectordb/chroma.sqlite3"
MAX_LIMIT = 25
SSH_BASE = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "vm"]

# Pure-stdlib program executed ON THE VM (read-only over chroma.sqlite3). It reads its
# inputs from a base64-encoded PARAMS line prepended by the launcher below, so no user
# text ever reaches the remote shell (injection-safe) and every query is parameterized.
_REMOTE_BODY = r'''
import sqlite3, json as _json

VECTORDB = "/home/trevor/trevor/vectordb/chroma.sqlite3"
MAX_LIMIT = 25


def _conn():
    return sqlite3.connect(f"file:{VECTORDB}?mode=ro", uri=True, timeout=10)


def _meta_for(cur, ids):
    out = {}
    if not ids:
        return out
    qmarks = ",".join("?" for _ in ids)
    rows = cur.execute(
        "SELECT id, key, string_value, int_value, float_value, bool_value "
        "FROM embedding_metadata WHERE id IN (" + qmarks + ") AND key != 'chroma:document'",
        list(ids),
    ).fetchall()
    for rid, key, sv, iv, fv, bv in rows:
        if sv is not None:
            val = sv
        elif iv is not None:
            val = iv
        elif fv is not None:
            val = fv
        elif bv is not None:
            val = bool(bv)
        else:
            val = None
        out.setdefault(rid, {})[key] = val
    return out


def _rows_to_items(cur, rows, with_distance):
    ids = [r[0] for r in rows]
    meta = _meta_for(cur, ids)
    items = []
    for rid, emb_id, doc in rows:
        item = {"id": emb_id, "document": doc, "metadata": (meta.get(rid) or None)}
        if with_distance:
            item["distance"] = None  # keyword search — no vector distance
        items.append(item)
    return items


def do_list(cur):
    rows = cur.execute(
        "SELECT c.name, COUNT(e.id) "
        "FROM collections c "
        "JOIN segments s ON s.collection = c.id AND s.scope='METADATA' "
        "LEFT JOIN embeddings e ON e.segment_id = s.id "
        "GROUP BY c.name"
    ).fetchall()
    cols = [{"name": n, "count": cnt} for n, cnt in rows]
    cols.sort(key=lambda r: r["name"])
    return {"mode": "list", "collections": cols}


def do_peek(cur, name, limit):
    rows = cur.execute(
        "SELECT e.id, e.embedding_id, em.string_value "
        "FROM embeddings e "
        "JOIN segments s ON e.segment_id = s.id AND s.scope='METADATA' "
        "JOIN collections c ON s.collection = c.id "
        "LEFT JOIN embedding_metadata em ON em.id = e.id AND em.key='chroma:document' "
        "WHERE c.name = ? ORDER BY e.id LIMIT ?",
        (name, limit),
    ).fetchall()
    return {"mode": "peek", "collection": name, "items": _rows_to_items(cur, rows, False)}


def do_search(cur, name, q, limit):
    qs = (q or "").strip()
    if len(qs) >= 3:
        # FTS5 trigram MATCH. Wrap as a quoted phrase so user text is a literal,
        # never interpreted as FTS operators (AND/OR/NEAR/*); value is also bound.
        match_expr = '"' + qs.replace('"', '""') + '"'
        rows = cur.execute(
            "SELECT e.id, e.embedding_id, em.string_value "
            "FROM embedding_fulltext_search fts "
            "JOIN embedding_metadata em ON em.id = fts.rowid AND em.key='chroma:document' "
            "JOIN embeddings e ON e.id = em.id "
            "JOIN segments s ON e.segment_id = s.id AND s.scope='METADATA' "
            "JOIN collections c ON s.collection = c.id "
            "WHERE c.name = ? AND fts.string_value MATCH ? LIMIT ?",
            (name, match_expr, limit),
        ).fetchall()
    else:
        # trigram needs >=3 chars; sub-trigram queries fall back to a LIKE substring.
        esc = qs.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        like = "%" + esc + "%"
        rows = cur.execute(
            "SELECT e.id, e.embedding_id, em.string_value "
            "FROM embedding_metadata em "
            "JOIN embeddings e ON e.id = em.id "
            "JOIN segments s ON e.segment_id = s.id AND s.scope='METADATA' "
            "JOIN collections c ON s.collection = c.id "
            "WHERE c.name = ? AND em.key='chroma:document' AND em.string_value LIKE ? ESCAPE '\\' "
            "LIMIT ?",
            (name, like, limit),
        ).fetchall()
    return {"mode": "search", "collection": name, "query": q, "items": _rows_to_items(cur, rows, True)}


try:
    mode = PARAMS["mode"]
    limit = max(1, min(MAX_LIMIT, int(PARAMS.get("limit") or 10)))
    conn = _conn()
    cur = conn.cursor()
    if mode == "list":
        result = do_list(cur)
    elif mode == "peek":
        result = do_peek(cur, PARAMS["collection"], limit)
    elif mode == "search":
        result = do_search(cur, PARAMS["collection"], PARAMS.get("q") or "", limit)
    else:
        result = {"mode": mode, "error": "unknown mode: " + str(mode)}
    conn.close()
    print(_json.dumps(result))
except Exception as _exc:
    print(_json.dumps({"mode": PARAMS.get("mode"), "error": f"{type(_exc).__name__}: {_exc}"}))
'''


def _unreachable(mode: str, params: dict[str, Any], detail: str) -> dict[str, Any]:
    out: dict[str, Any] = {"mode": mode, "vm_unreachable": True, "error": f"VM unreachable: {detail}"[:300]}
    if mode == "list":
        out["collections"] = []
    else:
        out["collection"] = params.get("collection")
        out["items"] = []
        if mode == "search":
            out["query"] = params.get("q")
    return out


def run_remote(params: dict[str, Any]) -> dict[str, Any]:
    payload = base64.b64encode(json.dumps(params).encode()).decode()
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
            timeout=45,
            # runPython does force HOME=/home/trevor, but ssh resolves ~/.ssh from the
            # process UID (getpwuid), NOT $HOME — this reset is DEFENSIVE ONLY (RF3T2-B8).
            env={**__import__("os").environ, "HOME": "/home/ghost"},
        )
    except subprocess.TimeoutExpired:
        return _unreachable(params["mode"], params, "ssh timeout")
    except Exception as exc:  # pragma: no cover - spawn failure
        return _unreachable(params["mode"], params, f"{type(exc).__name__}: {exc}")
    if proc.returncode != 0 or not proc.stdout.strip():
        return _unreachable(params["mode"], params, (proc.stderr or "ssh failed").strip())
    try:
        return json.loads(proc.stdout.strip())
    except json.JSONDecodeError:
        return _unreachable(params["mode"], params, "unparseable remote output")


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: query_chroma_browse.py list|peek|search ..."}), file=sys.stderr)
        sys.exit(2)
    mode = sys.argv[1]
    if mode == "list":
        print(json.dumps(run_remote({"mode": "list"})))
    elif mode == "peek":
        if len(sys.argv) < 3:
            print(json.dumps({"error": "usage: peek <collection> [limit]"}), file=sys.stderr)
            sys.exit(2)
        name = sys.argv[2]
        limit = int(sys.argv[3]) if len(sys.argv) >= 4 else 10
        print(json.dumps(run_remote({"mode": "peek", "collection": name, "limit": limit})))
    elif mode == "search":
        if len(sys.argv) < 4:
            print(json.dumps({"error": "usage: search <collection> <query> [limit]"}), file=sys.stderr)
            sys.exit(2)
        name = sys.argv[2]
        q = sys.argv[3]
        limit = int(sys.argv[4]) if len(sys.argv) >= 5 else 10
        print(json.dumps(run_remote({"mode": "search", "collection": name, "q": q, "limit": limit})))
    else:
        print(json.dumps({"error": f"unknown mode '{mode}'"}), file=sys.stderr)
        sys.exit(2)


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
