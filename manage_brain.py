#!/usr/bin/env python3
"""Brain file & ChromaDB management helper for Mission Control dashboard. READ-WRITE."""
import json, sys, os, time, shutil
from datetime import datetime


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    trevor_dir = os.environ.get("TREVOR_PROJECT_DIR", "/home/trevor/trevor")
    brain_dir = os.path.join(trevor_dir, "brain")
    vectordb_path = os.path.join(trevor_dir, "vectordb")

    try:
        if action == "write_file":
            name = sys.argv[2] if len(sys.argv) > 2 else ""
            content = sys.argv[3] if len(sys.argv) > 3 else ""
            if not name:
                print(json.dumps({"error": "File name required"}))
                return

            # --- W-C-P2a guard (defense in depth; /api/brain also checks) ---
            # Sacred files are INVIOLABLE. Normalize (strip .md, any case) so
            # IDENTITY.md / identity / SOUL.MD are ALL rejected. Exit 3 -> HTTP 423.
            _stripped = name.strip()
            _norm = (_stripped[:-3] if _stripped.lower().endswith(".md") else _stripped).upper()
            if _norm in ("IDENTITY", "BRAIN", "SOUL", "AGENTS"):
                print(json.dumps({"error": f"sacred file — write rejected: {name}"}), file=sys.stderr)
                sys.exit(3)
            # HUB_BRAIN_EDIT_ENABLED is an auto_config row (default OFF = absent or
            # != 'true'); read it read-only, fail CLOSED on any error. Exit 3 -> 423.
            import sqlite3 as _sqlite3
            _db = os.environ.get("TREVOR_DB_PATH", os.path.join(trevor_dir, "trevor.db"))
            _enabled = False
            try:
                _conn = _sqlite3.connect(f"file:{_db}?mode=ro", uri=True, timeout=10)
                _row = _conn.execute(
                    "SELECT value FROM auto_config WHERE key='HUB_BRAIN_EDIT_ENABLED'"
                ).fetchone()
                _conn.close()
                _enabled = bool(_row) and str(_row[0]).strip().lower() == "true"
            except Exception:
                _enabled = False
            if not _enabled:
                print(json.dumps({"error": "HUB_BRAIN_EDIT_ENABLED is false"}), file=sys.stderr)
                sys.exit(3)

            file_path = os.path.join(brain_dir, name)

            # Backup existing file if it exists
            backup_name = None
            if os.path.exists(file_path):
                timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
                backup_name = f"{name}.backup.{timestamp}"
                backup_path = os.path.join(brain_dir, backup_name)
                shutil.copy2(file_path, backup_path)

            # Write new content
            with open(file_path, "w", encoding="utf-8") as f:
                written = f.write(content)

            result = {"ok": True, "written": written}
            if backup_name:
                result["backup"] = backup_name
            print(json.dumps(result))

        elif action == "chroma_browse":
            collection_name = sys.argv[2] if len(sys.argv) > 2 else ""
            limit = int(sys.argv[3]) if len(sys.argv) > 3 else 20
            offset = int(sys.argv[4]) if len(sys.argv) > 4 else 0

            if not collection_name:
                print(json.dumps({"error": "Collection name required"}))
                return

            import chromadb
            client = chromadb.PersistentClient(path=vectordb_path)
            collection = client.get_collection(name=collection_name)
            total = collection.count()

            if total == 0:
                print(json.dumps({"entries": [], "total": 0, "collection": collection_name}))
                return

            # ChromaDB get() supports limit and offset
            result_data = collection.get(
                limit=limit,
                offset=offset,
                include=["documents", "metadatas"]
            )

            entries = []
            ids = result_data.get("ids", [])
            documents = result_data.get("documents", [])
            metadatas = result_data.get("metadatas", [])

            for i, entry_id in enumerate(ids):
                entry = {"id": entry_id}
                if documents and i < len(documents):
                    entry["document"] = documents[i]
                if metadatas and i < len(metadatas):
                    entry["metadata"] = metadatas[i]
                entries.append(entry)

            print(json.dumps({"entries": entries, "total": total, "collection": collection_name}))

        elif action == "chroma_search":
            collection_name = sys.argv[2] if len(sys.argv) > 2 else ""
            query = sys.argv[3] if len(sys.argv) > 3 else ""
            limit = int(sys.argv[4]) if len(sys.argv) > 4 else 5

            if not collection_name:
                print(json.dumps({"error": "Collection name required"}))
                return
            if not query:
                print(json.dumps({"error": "Query text required"}))
                return

            import chromadb
            client = chromadb.PersistentClient(path=vectordb_path)
            collection = client.get_collection(name=collection_name)

            result_data = collection.query(
                query_texts=[query],
                n_results=limit,
                include=["documents", "metadatas", "distances"]
            )

            results = []
            ids = result_data.get("ids", [[]])[0]
            documents = result_data.get("documents", [[]])[0]
            metadatas = result_data.get("metadatas", [[]])[0]
            distances = result_data.get("distances", [[]])[0]

            for i, entry_id in enumerate(ids):
                entry = {"id": entry_id}
                if i < len(documents):
                    entry["document"] = documents[i]
                if i < len(metadatas):
                    entry["metadata"] = metadatas[i]
                if i < len(distances):
                    entry["distance"] = distances[i]
                results.append(entry)

            print(json.dumps({"results": results, "query": query, "collection": collection_name}))

        elif action == "chroma_add":
            collection_name = sys.argv[2] if len(sys.argv) > 2 else ""
            document = sys.argv[3] if len(sys.argv) > 3 else ""
            metadata_json = sys.argv[4] if len(sys.argv) > 4 else "{}"

            if not collection_name:
                print(json.dumps({"error": "Collection name required"}))
                return
            if not document:
                print(json.dumps({"error": "Document text required"}))
                return

            metadata = json.loads(metadata_json)

            import chromadb
            client = chromadb.PersistentClient(path=vectordb_path)
            collection = client.get_or_create_collection(name=collection_name)

            entry_id = f"hub_{int(time.time() * 1000)}"
            collection.add(
                ids=[entry_id],
                documents=[document],
                metadatas=[metadata]
            )

            print(json.dumps({"ok": True, "id": entry_id}))

        elif action == "chroma_delete":
            collection_name = sys.argv[2] if len(sys.argv) > 2 else ""
            entry_id = sys.argv[3] if len(sys.argv) > 3 else ""

            if not collection_name:
                print(json.dumps({"error": "Collection name required"}))
                return
            if not entry_id:
                print(json.dumps({"error": "Entry ID required"}))
                return

            import chromadb
            client = chromadb.PersistentClient(path=vectordb_path)
            collection = client.get_collection(name=collection_name)
            collection.delete(ids=[entry_id])

            print(json.dumps({"ok": True, "deleted": entry_id}))

        else:
            print(json.dumps({"error": f"Unknown action: {action}"}))

    except Exception as e:
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
