import { NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";
import { gatewayWrite } from "@/lib/gateway-client";

// /api/memory/autotrader-toggle — Single Hub write surface for the
// AutoTrader on/off toggle (Rule 32 carve-out, 2026-05-02).
//
// GET  → query_autotrader_enabled.py   (read-only state + gate flag + last 5 audit rows)
// POST → set_autotrader_enabled.py     (flag-gated, idempotent, audit-row-on-change)
//        Body: { value: "true" | "false", author: string }
//        Responses:
//          200 — toggled or idempotent no-op (JSON includes prev/new values)
//          400 — bad request
//          423 — HUB_AUTOTRADER_TOGGLE_ENABLED is false (gate locked)
//          500 — internal / DB error
//
// Auth: middleware enforces session cookie on all /api/* (except auth/health).
// Mirrors /api/memory/aggressive contract exactly so the UI side can copy
// the existing 2-tap BottomSheet flow.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stdout = await runPython("query_autotrader_enabled.py", []);
    return NextResponse.json(JSON.parse(stdout));
  } catch (e) {
    return NextResponse.json(
      {
        enabled: true,
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

  // W-C-P2a: routed through the gateway → VM. HUB_AUTOTRADER_TOGGLE_ENABLED is
  // re-checked authoritatively VM-side (helper exits 3 → 423 when locked); the
  // audit row lands in autotrader_state_audit there. UX contract unchanged.
  return gatewayWrite(
    "autotrader.toggle",
    { value, author },
    { actor: `hub:${author}`, reason: `autotrader.toggle=${value}` },
  );
}
