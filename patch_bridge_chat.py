#!/usr/bin/env python3
"""Patch n8n_bridge.py to add /n8n/data/chat endpoint."""
import sys

bridge_path = "/home/trevor/trevor/n8n_bridge.py"

with open(bridge_path, "r") as f:
    content = f.read()

# Check if already patched
if "/n8n/data/chat" in content:
    print("Already patched — /n8n/data/chat endpoint exists")
    sys.exit(0)

# Add ChatRequest model after DiscordDispatchRequest
chat_model = '''

class ChatRequest(BaseModel):
    message: str
    source: str = "dashboard"
'''

content = content.replace(
    "class DiscordDispatchRequest(BaseModel):\n    channel: str\n    content: str\n    embed: Optional[Dict[str, Any]] = None",
    "class DiscordDispatchRequest(BaseModel):\n    channel: str\n    content: str\n    embed: Optional[Dict[str, Any]] = None" + chat_model
)

# Add chat endpoint before the entry point section
chat_endpoint = '''

@app.post("/n8n/data/chat")
async def chat_endpoint(req: ChatRequest):
    """
    Chat endpoint — routes dashboard messages through SwarmsBrain.
    Returns the brain's response as JSON.
    """
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message required")

    try:
        _, _, brain = _get_components()
        loop = asyncio.get_event_loop()
        # Use brain.process_message or brain.chat depending on what exists
        if hasattr(brain, "process_message"):
            response = await loop.run_in_executor(None, brain.process_message, req.message, req.source)
        elif hasattr(brain, "chat"):
            response = await loop.run_in_executor(None, brain.chat, req.message)
        elif hasattr(brain, "analyze"):
            response = await loop.run_in_executor(None, brain.analyze, req.message)
        else:
            response = "Brain does not have a chat-compatible method."

        if isinstance(response, dict):
            text = response.get("response", response.get("message", str(response)))
        else:
            text = str(response)

        return JSONResponse(content={"response": text, "source": req.source})
    except Exception as exc:
        log.error(f"Chat error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))

'''

# Insert before entry point
content = content.replace(
    "# ---------------------------------------------------------------------------\n# Entry point",
    chat_endpoint + "# ---------------------------------------------------------------------------\n# Entry point"
)

with open(bridge_path, "w") as f:
    f.write(content)

print("Patched successfully — added /n8n/data/chat endpoint")
