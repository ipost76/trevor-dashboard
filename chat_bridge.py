#!/usr/bin/env python3
"""Chat bridge for Mission Control dashboard.
Uses Anthropic API directly with TREVOR's personality context."""
import json, sys, os, glob

def load_brain_context(trevor_dir):
    """Load TREVOR's identity context from brain files."""
    brain_dir = os.path.join(trevor_dir, "brain")
    context_parts = []
    for name in ["IDENTITY", "BRAIN", "SOUL"]:
        for ext in ["", ".md"]:
            path = os.path.join(brain_dir, f"{name}{ext}")
            if os.path.exists(path):
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        content = f.read()[:3000]
                    context_parts.append(f"--- {name} ---\n{content}")
                except Exception:
                    pass
                break
    return "\n\n".join(context_parts)

def load_chat_history(data_dir, session_id, max_messages=12):
    """Load recent chat history from session file."""
    session_file = os.path.join(data_dir, f"{session_id}.json")
    if os.path.exists(session_file):
        try:
            with open(session_file, "r") as f:
                messages = json.load(f)
            return messages[-max_messages:]
        except Exception:
            pass
    return []

def save_message(data_dir, session_id, role, content):
    """Append a message to the session file."""
    session_file = os.path.join(data_dir, f"{session_id}.json")
    messages = []
    if os.path.exists(session_file):
        try:
            with open(session_file, "r") as f:
                messages = json.load(f)
        except Exception:
            pass
    messages.append({"role": role, "content": content, "timestamp": __import__("datetime").datetime.utcnow().isoformat() + "Z"})
    # Auto-rotate at 50 messages
    if len(messages) > 50:
        messages = messages[-12:]
    os.makedirs(data_dir, exist_ok=True)
    with open(session_file, "w") as f:
        json.dump(messages, f)

def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "health"
    trevor_dir = os.environ.get("TREVOR_PROJECT_DIR", "/home/trevor/trevor")
    dashboard_dir = os.environ.get("DASHBOARD_DIR", os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(dashboard_dir, "data", "chat-sessions")

    if action == "health":
        # Check if Anthropic API key exists
        api_key = None
        env_file = os.path.join(trevor_dir, ".env")
        if os.path.exists(env_file):
            with open(env_file) as f:
                for line in f:
                    if line.startswith("ANTHROPIC_API_KEY="):
                        api_key = line.split("=", 1)[1].strip()
                        break
        online = bool(api_key and len(api_key) > 10)
        print(json.dumps({"online": online, "status": "ready" if online else "no_api_key"}))

    elif action == "chat":
        message = sys.argv[2] if len(sys.argv) > 2 else ""
        session_id = sys.argv[3] if len(sys.argv) > 3 else "default"

        if not message:
            print(json.dumps({"error": "Message required", "ok": False}))
            return

        # Load API key
        api_key = None
        env_file = os.path.join(trevor_dir, ".env")
        if os.path.exists(env_file):
            with open(env_file) as f:
                for line in f:
                    if line.startswith("ANTHROPIC_API_KEY="):
                        api_key = line.split("=", 1)[1].strip()
                        break

        if not api_key:
            print(json.dumps({"error": "No API key configured", "ok": False}))
            return

        # Load brain context
        brain_context = load_brain_context(trevor_dir)
        system_prompt = f"""You are TREVOR, an autonomous quantitative trading AI system. You are responding via the Mission Control Hub dashboard.

{brain_context}

Keep responses concise and direct. Use trading/quant terminology naturally. You have access to market data, training data, and trading signals. When asked about specific tickers or trades, provide what you know from your context."""

        # Load conversation history
        history = load_chat_history(data_dir, session_id)
        api_messages = []
        for msg in history:
            api_messages.append({"role": msg["role"], "content": msg["content"]})
        api_messages.append({"role": "user", "content": message})

        # Call Anthropic API
        import urllib.request
        payload = json.dumps({
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 1024,
            "system": system_prompt,
            "messages": api_messages
        }).encode()

        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01"
            },
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode())
                response_text = data["content"][0]["text"] if data.get("content") else "No response"

            # Save both messages to history
            save_message(data_dir, session_id, "user", message)
            save_message(data_dir, session_id, "assistant", response_text)

            print(json.dumps({"response": response_text, "ok": True, "sessionId": session_id}))
        except Exception as e:
            print(json.dumps({"error": str(e), "ok": False}))

    elif action == "history":
        session_id = sys.argv[2] if len(sys.argv) > 2 else "default"
        limit = int(sys.argv[3]) if len(sys.argv) > 3 else 50
        messages = load_chat_history(data_dir, session_id, limit)
        print(json.dumps({"messages": messages}))

    elif action == "sessions":
        os.makedirs(data_dir, exist_ok=True)
        sessions = []
        for f in sorted(glob.glob(os.path.join(data_dir, "*.json")), key=os.path.getmtime, reverse=True):
            name = os.path.basename(f).replace(".json", "")
            try:
                with open(f) as fh:
                    msgs = json.load(fh)
                sessions.append({"id": name, "messageCount": len(msgs), "lastMessage": msgs[-1]["timestamp"] if msgs else ""})
            except Exception:
                pass
        print(json.dumps({"sessions": sessions}))

    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))

if __name__ == "__main__":
    main()
