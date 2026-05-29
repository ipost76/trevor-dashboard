import { NextResponse } from "next/server";
import { runPython, runPythonResult } from "@/lib/api-helpers";

// /api/reminders — Hub surface for the bot's ReminderManager.
//
// GET  → query_reminders.py  → { reminders: [...], summary: {pending, active, completed, cancelled} }
// POST → set_reminders.py    body: { action: "add"|"complete"|"cancel"|"edit", ...params }
//        Responses: 200 (success), 400 (usage/invalid), 423 unused, 500 (DB/unexpected)
//
// Auth: middleware enforces session cookie on all /api/* (except auth/health).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ACTIONS = new Set(["add", "complete", "cancel", "edit"]);

export async function GET() {
  try {
    const stdout = await runPython("query_reminders.py", []);
    return NextResponse.json(JSON.parse(stdout));
  } catch (e) {
    return NextResponse.json(
      {
        reminders: [],
        summary: { pending: 0, active: 0, completed: 0, cancelled: 0 },
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

  // runPythonResult (async) so we can read stdout regardless of exit code —
  // set_reminders.py emits a JSON payload on exit 1/2/4 too. Async → never
  // blocks the loop.
  let result;
  try {
    result = await runPythonResult("set_reminders.py", [action], {
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
