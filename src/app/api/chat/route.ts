import { NextRequest, NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

// All Python crosses the boundary via the async bridge (argv array / stdin bytes,
// NO shell). The bridge runs the venv python3 with cwd=TREVOR_DIR and resolves the
// script relative to DASHBOARD_DIR — identical to the prior local helper, now async
// so a slow/hung child can never block the event loop.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || searchParams.get("scope") || "health";

  try {
    if (action === "health") {
      const raw = await runPython("chat_bridge.py", ["health"], { timeout: 10000 });
      return NextResponse.json(JSON.parse(raw));
    }

    if (action === "history") {
      // Whitelist: 1-4 digit integer only. chat_bridge.py does int(argv[2]).
      const limitRaw = searchParams.get("limit") || "50";
      const limit = /^\d{1,4}$/.test(limitRaw) ? limitRaw : "50";
      const raw = await runPython("chat_bridge.py", ["history", limit], { timeout: 15000 });
      return NextResponse.json(JSON.parse(raw));
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) });
  }
}

// Rate limiting — 30 messages per hour
const _chatLog: number[] = [];
const MAX_PER_HOUR = 30;

export async function POST(request: NextRequest) {
  const now = Date.now();
  while (_chatLog.length > 0 && _chatLog[0] < now - 3600000) _chatLog.shift();
  if (_chatLog.length >= MAX_PER_HOUR) {
    return NextResponse.json({ error: "Rate limit exceeded (30/hour)" }, { status: 429 });
  }
  _chatLog.push(now);

  const body = await request.json();
  const messages = body.messages;

  // Legacy single-message format — route through chat_bridge as argv (no shell).
  if (!messages && body.message) {
    try {
      // User input crosses as argv[2]. NO shell, NO escape dance. 2000-char cap.
      const msg = String(body.message ?? "").slice(0, 2000);
      const raw = await runPython("chat_bridge.py", ["chat", msg], { timeout: 90000 });
      return NextResponse.json(JSON.parse(raw));
    } catch (err) {
      return NextResponse.json({ error: String(err), ok: false }, { status: 500 });
    }
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "No messages provided" }, { status: 400 });
  }

  try {
    // Pipe JSON via stdin — no shell echo, no interpolation.
    const input = JSON.stringify({ messages: messages.slice(-10) });
    const raw = await runPython("chat_ai.py", [], { timeout: 30000, input });
    const data = JSON.parse(raw);
    if (data.error) {
      return NextResponse.json({ error: data.error }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
