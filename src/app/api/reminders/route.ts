import { NextResponse } from "next/server";
import { join } from "path";
import { spawnSync } from "child_process";
import { runPython, PYTHON_PATH, DASHBOARD_DIR, TREVOR_DIR } from "@/lib/api-helpers";

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
    const stdout = runPython("query_reminders.py", []);
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

  // Spawn directly (NOT runPython) so we can read stdout regardless of exit
  // code — set_reminders.py emits a JSON payload on exit 1/2/4 too.
  const scriptPath = join(DASHBOARD_DIR, "set_reminders.py");
  const result = spawnSync(PYTHON_PATH, [scriptPath, action], {
    encoding: "utf-8",
    timeout: 10000,
    cwd: TREVOR_DIR,
    env: { ...process.env, HOME: "/home/trevor" },
    input: JSON.stringify(body),
    maxBuffer: 1 * 1024 * 1024,
  });

  if (result.error) {
    return NextResponse.json(
      { ok: false, error: String(result.error) },
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
