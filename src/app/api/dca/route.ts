import { NextResponse } from "next/server";
import { runPython, runPythonResult } from "@/lib/api-helpers";

// /api/dca — Hub surface for the bot's DCAManager.
//
// GET  → query_dca.py  → { entries: [...], summary: {total_active, total_paused, daily_total, monthly_estimate} }
// POST → set_dca.py    body: { action: "add"|"remove"|"edit"|"pause"|"resume", ...params }
//        Responses: 200 (success), 400 (usage/invalid), 500 (DB/unexpected)
//
// Auth: middleware enforces session cookie on all /api/* (except auth/health).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ACTIONS = new Set(["add", "remove", "edit", "pause", "resume"]);

export async function GET() {
  try {
    const stdout = await runPython("query_dca.py", []);
    return NextResponse.json(JSON.parse(stdout));
  } catch (e) {
    return NextResponse.json(
      {
        entries: [],
        summary: {
          total_active: 0,
          total_paused: 0,
          daily_total: 0,
          monthly_estimate: 0,
        },
        error: String(e),
      },
      { status: 200 },
    );
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const action = String(body.action ?? "").trim().toLowerCase();
  if (!ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json(
      { ok: false, error: `unknown action: ${action || "(none)"}` },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await runPythonResult("set_dca.py", [action], {
      timeout: 10000,
      input: JSON.stringify(body),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }

  if (result.timedOut || result.signal) {
    return NextResponse.json(
      { ok: false, error: result.timedOut ? "python timed out" : `python killed by ${result.signal}` },
      { status: 500 },
    );
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse((result.stdout || "").trim() || "{}");
  } catch {
    parsed = {
      ok: false,
      raw: (result.stdout || "").slice(0, 500),
      error: "non-JSON output",
    };
  }

  if (result.status === 0) return NextResponse.json(parsed, { status: 200 });
  if (result.status === 1 || result.status === 4)
    return NextResponse.json(parsed, { status: 400 });
  return NextResponse.json(
    {
      ...parsed,
      stderr: (result.stderr || "").slice(0, 500),
      exit_code: result.status,
    },
    { status: 500 },
  );
}
