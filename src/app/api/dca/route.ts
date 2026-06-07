import { NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";
import { gatewayWrite } from "@/lib/gateway-client";

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

  // W-C-P2a: routed through the gateway → VM (HUB_TRADE_EDIT_ENABLED, audited).
  // The full body (action + params) becomes the op args; the VM helper consumes
  // it exactly as set_dca.py did from stdin.
  return gatewayWrite("dca.set", { ...body, action }, { reason: `dca.set:${action} via Hub` });
}
