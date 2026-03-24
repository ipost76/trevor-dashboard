#!/usr/bin/env python3
"""Chat bridge helper for Mission Control dashboard.
Routes messages through n8n bridge (port 8765) which has a SwarmsBrain instance."""
import json, sys, os, urllib.request, urllib.error

def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "health"
    bridge_url = os.environ.get("N8N_BRIDGE_URL", "http://localhost:8765")

    if action == "health":
        try:
            req = urllib.request.Request(f"{bridge_url}/n8n/health", method="GET")
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode())
                print(json.dumps({"online": True, "status": data}))
        except Exception as e:
            print(json.dumps({"online": False, "error": str(e)}))

    elif action == "chat":
        message = sys.argv[2] if len(sys.argv) > 2 else ""
        if not message:
            print(json.dumps({"error": "Message required"}))
            return

        try:
            payload = json.dumps({"message": message, "source": "dashboard"}).encode()
            req = urllib.request.Request(
                f"{bridge_url}/n8n/data/chat",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode())
                print(json.dumps({"response": data.get("response", data.get("message", str(data))), "ok": True}))
        except urllib.error.HTTPError as e:
            # Try alternative endpoint
            try:
                payload = json.dumps({"message": message, "source": "dashboard"}).encode()
                req = urllib.request.Request(
                    f"{bridge_url}/chat",
                    data=payload,
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                with urllib.request.urlopen(req, timeout=60) as resp:
                    data = json.loads(resp.read().decode())
                    print(json.dumps({"response": data.get("response", data.get("message", str(data))), "ok": True}))
            except Exception as e2:
                print(json.dumps({"error": f"Bridge error: {e} / {e2}", "ok": False}))
        except Exception as e:
            print(json.dumps({"error": str(e), "ok": False}))

    elif action == "history":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 50
        try:
            # Try to read from ChromaDB conversation_history
            trevor_dir = os.environ.get("TREVOR_PROJECT_DIR", "/home/trevor/trevor")
            sys.path.insert(0, trevor_dir)
            import chromadb
            client = chromadb.PersistentClient(path=os.path.join(trevor_dir, "vectordb"))
            col = client.get_collection("conversation_history")
            results = col.get(limit=limit, include=["documents", "metadatas"])
            messages = []
            for i, doc in enumerate(results["documents"]):
                meta = results["metadatas"][i] if results["metadatas"] else {}
                messages.append({
                    "content": doc,
                    "role": meta.get("role", "assistant"),
                    "timestamp": meta.get("timestamp", ""),
                    "source": meta.get("source", ""),
                })
            # Sort by timestamp descending
            messages.sort(key=lambda m: m.get("timestamp", ""), reverse=True)
            print(json.dumps({"messages": messages[:limit]}))
        except Exception as e:
            print(json.dumps({"messages": [], "error": str(e)}))

    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))

if __name__ == "__main__":
    main()
