import { NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";
import { gatewayWrite } from "@/lib/gateway-client";

// /api/auto/exit-controls — Hub write surface for the Momentum Confirm
// Cycles production gate (B3, 2026-05-27).
//
// GET  → query_confirm_cycles.py        (state + gate flag + last 5 audit rows)
// POST → set_confirm_cycles_promoted.py (flag-gated, idempotent, audit-row-on-change)
//        Body: { value: "true" | "false", author?: string }
//        Responses:
//          200 — toggled or idempotent no-op (JSON includes prev/new values)
//          400 — bad request
//          423 — HUB_CONFIRM_CYCLES_TOGGLE_ENABLED is false (gate locked)
//          500 — internal / DB error
//
// Auth: middleware enforces session cookie on all /api/* (except auth/health).
// Mirrors the /api/memory/autotrader-toggle contract line-for-line so the
// UI side reuses the same fetch + error-mapping pattern. Audit rows land in
// the existing autotrader_state_audit table (per Ghost ruling at B3 Phase 0
// — fewer moving parts, toggle surfaces in AutoTrader Control's "Recent
// Toggles" list for free).

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stdout = await runPython("query_confirm_cycles.py", []);
    return NextResponse.json(JSON.parse(stdout));
  } catch (e) {
    return NextResponse.json(
      {
        promoted: false,
        confirm_cycles: 0,
        toggle_enabled: false,
        shadow_enabled: false,
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

  // W-C-P2a: routed through the gateway → VM. HUB_CONFIRM_CYCLES_TOGGLE_ENABLED
  // is re-checked authoritatively VM-side (helper exits 3 → 423 when locked);
  // audit row lands in autotrader_state_audit there. UX contract unchanged.
  return gatewayWrite(
    "exit_controls.set",
    { value, author },
    { actor: `hub:${author}`, reason: `exit_controls.set=${value}` },
  );
}
