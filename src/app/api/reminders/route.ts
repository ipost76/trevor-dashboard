import { NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";
import { gatewayWrite } from "@/lib/gateway-client";

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

  // W-C-P2b: routed through the gateway → VM (HUB_BENIGN_WRITE_ENABLED, audited).
  // set_reminders.py no longer runs against the read-only replica. The whole
  // body (action + params) crosses as the op args; the VM helper owns add/
  // complete/cancel/edit. Invalid JSON / bad action are already 400'd above;
  // success unwraps to {ok,id}. Fail-closed: VM down → 502 (never a replica
  // write, never an orphaned reminder).
  return gatewayWrite(
    "reminders.set",
    { ...body, action },
    { reason: `reminders.${action} via Hub` },
  );
}
