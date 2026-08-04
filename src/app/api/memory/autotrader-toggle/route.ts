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
    // 🚨 B1-MONEY-PATH-HONESTY: a producer-only fix dies here. This fallback
    // used to assert `enabled: true, killswitch_enabled: false` — a confident
    // "AutoTrader ON, emergency stop DISENGAGED" minted by the route itself,
    // from no reading at all, whenever the helper threw. It would have
    // flattened the helper's new `null` straight back to a green all-clear.
    // Every field is kept present and populated; only the value changed.
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

  // W-C-P2a: routed through the gateway → VM. HUB_AUTOTRADER_TOGGLE_ENABLED is
  // re-checked authoritatively VM-side (helper exits 3 → 423 when locked); the
  // audit row lands in autotrader_state_audit there. UX contract unchanged.
  // B7: the VM gateway op contract wants a boolean `enabled` (not the string
  // `value`) — remap here so the call clears VM-side validation instead of 400ing.
  return gatewayWrite(
    "autotrader.toggle",
    { enabled: value === "true", author },
    { actor: `hub:${author}`, reason: `autotrader.toggle=${value}` },
  );
}
