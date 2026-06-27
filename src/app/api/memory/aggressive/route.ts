import { NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";
import { gatewayWrite } from "@/lib/gateway-client";

// /api/memory/aggressive — G2 single-write surface for Aggressive Mode.
//
// GET  → query_aggressive.py     (read-only state + flag + last 5 audit rows)
// POST → set_aggressive.py       (flag-gated, idempotent, audit-row-on-change)
//        Body: { value: "true" | "false", author: string }
//        Responses:
//          200 — toggled or idempotent no-op (JSON includes prev/new values)
//          400 — bad request
//          423 — HUB_AGGRESSIVE_TOGGLE_ENABLED is false (gate locked)
//          500 — internal / DB error
//
// Auth: middleware enforces session cookie on all /api/* (except auth/health).

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stdout = await runPython("query_aggressive.py", []);
    return NextResponse.json(JSON.parse(stdout));
  } catch (e) {
    return NextResponse.json(
      {
        enabled: false,
        threshold_delta: 0,
        toggle_enabled: false,
        killswitch_enabled: false,
        audit: [],
        error: String(e),
      },
      { status: 200 },
    );
  }
}

export async function POST(request: Request) {
  let body: { value?: unknown; author?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const value = String(body.value ?? "").trim().toLowerCase();
  const author = String(body.author ?? "ghost").trim() || "ghost";
  if (value !== "true" && value !== "false") {
    return NextResponse.json(
      { ok: false, error: "value must be 'true' or 'false'" },
      { status: 400 },
    );
  }

  // W-C-P2a: routed through the gateway → VM. HUB_AGGRESSIVE_TOGGLE_ENABLED is
  // re-checked authoritatively VM-side (helper exits 3 → 423 when locked); stays
  // queue-style (the bot consumes the state change). UX contract unchanged.
  // B7: the VM gateway op contract wants a boolean `enabled` (not the string
  // `value`) — remap here so the call clears VM-side validation instead of 400ing.
  return gatewayWrite(
    "aggressive.set",
    { enabled: value === "true", author },
    { actor: `hub:${author}`, reason: `aggressive.set=${value}` },
  );
}
