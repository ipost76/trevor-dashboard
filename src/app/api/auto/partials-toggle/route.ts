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
    // 🚨 B1-MONEY-PATH-HONESTY: this fallback asserted `enabled: false,
    // killswitch_enabled: false` — a confident all-clear about a money-path
    // control and the emergency stop, minted by the route from no reading at
    // all, and it would have flattened the helper's new `null` right back to
    // it. Every field kept present and populated; only the value changed.
    return NextResponse.json(
      {
        enabled: null,
        toggle_enabled: null,
        killswitch_enabled: null,
        enabled_state: "unknown",
        toggle_state: "unknown",
        killswitch_state: "unknown",
        audit_state: "unknown",
        read_state: "unknown",
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
  // B7: the VM gateway op contract wants a boolean `enabled` (not the string
  // `value`) — remap here so the call clears VM-side validation instead of 400ing.
  return gatewayWrite(
    "partials.toggle",
    { enabled: value === "true", author },
    { actor: `hub:${author}`, reason: `partials.toggle=${value}` },
  );
}
