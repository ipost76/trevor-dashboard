#!/usr/bin/env python3
"""ChromaDB browser: list / peek / search.

Modes:
  list                                 — collections + counts
  peek <collection> [limit]            — sample documents
  search <collection> <query> [limit]  — semantic text search

Caps: max limit 25; embeddings never returned (bandwidth).
"""
from __future__ import annotations

import json
import sys
from typing import Any

VECTORDB = "/home/trevor/trevor/vectordb"
MAX_LIMIT = 25


def list_collections() -> dict[str, Any]:
    import chromadb
    client = chromadb.PersistentClient(path=VECTORDB)
    out = []
    for c in client.list_collections():
        try:
            n = c.count()
        except Exception:
            n = -1
        out.append({"name": c.name, "count": n})
    out.sort(key=lambda r: r["name"])
    return {"mode": "list", "collections": out}


def peek_collection(name: str, limit: int) -> dict[str, Any]:
    import chromadb
    client = chromadb.PersistentClient(path=VECTORDB)
    coll = client.get_collection(name)
    res = coll.get(limit=min(limit, MAX_LIMIT), include=["metadatas", "documents"])
    items = []
    ids = res.get("ids", []) or []
    docs = res.get("documents", []) or []
    metas = res.get("metadatas", []) or []
    for i, doc_id in enumerate(ids):
        items.append({
            "id": doc_id,
            "document": docs[i] if i < len(docs) else None,
            "metadata": metas[i] if i < len(metas) else None,
        })
    return {"mode": "peek", "collection": name, "items": items}


def search_collection(name: str, query: str, limit: int) -> dict[str, Any]:
    import chromadb
    client = chromadb.PersistentClient(path=VECTORDB)
    coll = client.get_collection(name)
    res = coll.query(
        query_texts=[query],
        n_results=min(limit, MAX_LIMIT),
        include=["metadatas", "documents", "distances"],
    )
    items = []
    ids_outer = res.get("ids") or []
    if ids_outer and ids_outer[0]:
        ids = ids_outer[0]
        docs = (res.get("documents") or [[]])[0] or []
        metas = (res.get("metadatas") or [[]])[0] or []
        dists = (res.get("distances") or [[]])[0] or []
        for i, doc_id in enumerate(ids):
            items.append({
                "id": doc_id,
                "document": docs[i] if i < len(docs) else None,
                "metadata": metas[i] if i < len(metas) else None,
                "distance": dists[i] if i < len(dists) else None,
            })
    return {"mode": "search", "collection": name, "query": query, "items": items}


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: query_chroma_browse.py list|peek|search ..."}), file=sys.stderr)
        sys.exit(2)
    mode = sys.argv[1]
    try:
        if mode == "list":
            print(json.dumps(list_collections()))
        elif mode == "peek":
            if len(sys.argv) < 3:
                print(json.dumps({"error": "usage: peek <collection> [limit]"}), file=sys.stderr)
                sys.exit(2)
            name = sys.argv[2]
            limit = int(sys.argv[3]) if len(sys.argv) >= 4 else 10
            print(json.dumps(peek_collection(name, limit)))
        elif mode == "search":
            if len(sys.argv) < 4:
                print(json.dumps({"error": "usage: search <collection> <query> [limit]"}), file=sys.stderr)
                sys.exit(2)
            name = sys.argv[2]
            q = sys.argv[3]
            limit = int(sys.argv[4]) if len(sys.argv) >= 5 else 10
            print(json.dumps(search_collection(name, q, limit)))
        else:
            print(json.dumps({"error": f"unknown mode '{mode}'"}), file=sys.stderr)
            sys.exit(2)
    except Exception as exc:
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
