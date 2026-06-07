import { NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";
import { gatewayWrite } from "@/lib/gateway-client";

// /api/auto/partials-toggle — Hub write surface for LIVE_PARTIALS_ENABLED
// (B4, 2026-05-27). Defaults to false; toggle promotes Layer 5 partial
// exits from shadow-only to live execution.
//
// GET  → query_live_partials_enabled.py    (state + gate flag + last 5 partial-toggle audit rows)
// POST → set_live_partials_enabled.py      (flag-gated, idempotent, audit-row-on-change)
//        Body: { value: "true" | "false", author?: string }
//        Responses:
//          200 — toggled or idempotent no-op (JSON includes prev/new values)
//          400 — bad request
//          423 — HUB_LIVE_PARTIALS_TOGGLE_ENABLED is false (gate locked)
//          500 — internal / DB error
//
// Auth: middleware enforces session cookie on all /api/* (except auth/health).
// Mirrors /api/memory/autotrader-toggle + /api/auto/exit-controls contracts
// line-for-line; audit rows land in autotrader_state_audit (action prefix
// 'live_partials_*') so they surface in AutoTrader Control's "Recent Toggles".

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stdout = await runPython("query_live_partials_enabled.py", []);
    return NextResponse.json(JSON.parse(stdout));
  } catch (e) {
    return NextResponse.json(
      {
        enabled: false,
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

  // W-C-P2a: routed through the gateway → VM. HUB_LIVE_PARTIALS_TOGGLE_ENABLED is
  // re-checked authoritatively VM-side (helper exits 3 → 423 when locked); audit
  // row lands in autotrader_state_audit there. UX contract unchanged.
  return gatewayWrite(
    "partials.toggle",
    { value, author },
    { actor: `hub:${author}`, reason: `partials.toggle=${value}` },
  );
}
