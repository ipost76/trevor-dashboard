import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { spawnSync } from "child_process";

export const dynamic = "force-dynamic";

// Run a python helper with argv array (NO shell) and optional stdin input.
// NEVER interpolate user-controlled strings into shell commands — all user
// input crosses the boundary as argv elements or stdin bytes.
function runPython(
  scriptPath: string,
  args: string[],
  input: string | undefined,
  timeoutMs: number,
  cwd: string,
): string {
  const pythonPath = join(cwd, "venv", "bin", "python3");
  const result = spawnSync(pythonPath, [scriptPath, ...args], {
    encoding: "utf-8",
    timeout: timeoutMs,
    cwd,
    env: { ...process.env, HOME: "/home/trevor" },
    input,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`python exit=${result.status}: ${(result.stderr || "").slice(0, 500)}`);
  }
  return (result.stdout || "").trim();
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || searchParams.get("scope") || "health";

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const scriptPath = join(process.cwd(), "chat_bridge.py");

  try {
    if (action === "health") {
      const raw = runPython(scriptPath, ["health"], undefined, 10000, trevorDir);
      return NextResponse.json(JSON.parse(raw));
    }

    if (action === "history") {
      // Whitelist: 1-4 digit integer only. chat_bridge.py does int(argv[2]).
      const limitRaw = searchParams.get("limit") || "50";
      const limit = /^\d{1,4}$/.test(limitRaw) ? limitRaw : "50";
      const raw = runPython(scriptPath, ["history", limit], undefined, 15000, trevorDir);
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
    const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
    const scriptPath = join(process.cwd(), "chat_bridge.py");
    try {
      // User input crosses as argv[2]. NO shell, NO escape dance. 2000-char cap.
      const msg = String(body.message ?? "").slice(0, 2000);
      const raw = runPython(scriptPath, ["chat", msg], undefined, 90000, trevorDir);
      return NextResponse.json(JSON.parse(raw));
    } catch (err) {
      return NextResponse.json({ error: String(err), ok: false }, { status: 500 });
    }
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "No messages provided" }, { status: 400 });
  }

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const aiScript = join(process.cwd(), "chat_ai.py");

  try {
    // Pipe JSON via stdin — no shell echo, no interpolation.
    const input = JSON.stringify({ messages: messages.slice(-10) });
    const raw = runPython(aiScript, [], input, 30000, trevorDir);
    const data = JSON.parse(raw);
    if (data.error) {
      return NextResponse.json({ error: data.error }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
