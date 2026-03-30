import { NextRequest, NextResponse } from "next/server";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || searchParams.get("scope") || "health";

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = join(trevorDir, "venv", "bin", "python3");
  const scriptPath = join(process.cwd(), "chat_bridge.py");

  try {
    const { execSync } = await import("child_process");

    if (action === "health") {
      const raw = execSync(
        `${pythonPath} ${scriptPath} health`,
        { encoding: "utf-8", timeout: 10000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
      ).trim();
      return NextResponse.json(JSON.parse(raw));
    }

    if (action === "history") {
      const limit = searchParams.get("limit") || "50";
      const raw = execSync(
        `${pythonPath} ${scriptPath} history ${limit}`,
        { encoding: "utf-8", timeout: 15000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
      ).trim();
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
  // Rate limit check
  const now = Date.now();
  while (_chatLog.length > 0 && _chatLog[0] < now - 3600000) _chatLog.shift();
  if (_chatLog.length >= MAX_PER_HOUR) {
    return NextResponse.json({ error: "Rate limit exceeded (30/hour)" }, { status: 429 });
  }
  _chatLog.push(now);

  const body = await request.json();
  const messages = body.messages;

  // Support both old format (message string) and new format (messages array)
  if (!messages && body.message) {
    // Legacy single-message format — route through old chat_bridge
    const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
    const pythonPath = join(trevorDir, "venv", "bin", "python3");
    const scriptPath = join(process.cwd(), "chat_bridge.py");
    try {
      const { execSync } = await import("child_process");
      const sanitized = (body.message as string).replace(/[`$\\!#]/g, "").replace(/"/g, '\\"').slice(0, 2000);
      const raw = execSync(
        `${pythonPath} ${scriptPath} chat "${sanitized}"`,
        { encoding: "utf-8", timeout: 90000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
      ).trim();
      return NextResponse.json(JSON.parse(raw));
    } catch (err) {
      return NextResponse.json({ error: String(err), ok: false }, { status: 500 });
    }
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "No messages provided" }, { status: 400 });
  }

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = join(trevorDir, "venv", "bin", "python3");
  const aiScript = join(process.cwd(), "chat_ai.py");

  try {
    const { execSync } = await import("child_process");
    const input = JSON.stringify({ messages: messages.slice(-10) });
    const raw = execSync(
      `echo ${JSON.stringify(input)} | ${pythonPath} ${aiScript}`,
      { encoding: "utf-8", timeout: 30000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
    ).trim();
    const data = JSON.parse(raw);
    if (data.error) {
      return NextResponse.json({ error: data.error }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
