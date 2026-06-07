import { NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";
import { callGateway, gatewayResponse } from "@/lib/gateway-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 5-second cache matches the client poll cadence in KillswitchPill.tsx —
// coalesces multi-tab requests, keeps Python spawn rate to <1/sec.
// PERF-02 (2026-06-02): single-flight + SWR so a multi-tab burst collapses to
// ONE spawn per window. POST still busts the cache (cache.clear()) so a toggle
// is reflected on the very next poll.
const cache = createSwrCache<unknown>({ defaultTtl: 5_000, concurrency: 2 });

/**
 * GET /api/killswitch
 * Returns { enabled, lastToggle, lastAuthor, lastReason }.
 *
 * Auth via session cookie middleware (inherited from /api/* protection).
 *
 * Fail-safe: on Python helper or DB error, returns 500 with
 * { enabled: false, error: "..." } so the KillswitchPill stays hidden
 * (visual fail-safe — never falsely shows STANDBY when DB unreachable).
 */
export async function GET() {
  try {
    const { value } = await cache.swr("killswitch", async () => {
      const raw = await runPython("query_killswitch_state.py", [], { timeout: 5_000 });
      return JSON.parse(raw);
    });
    return NextResponse.json(value);
  } catch (e) {
    return NextResponse.json(
      { enabled: false, error: String(e) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/killswitch
 * Body: { action: "on"|"off", reason?: string, author?: string }
 *
 * Single Hub write surface for EMERGENCY_KILLSWITCH per the Hub-Only
 * Control Doctrine (BEHAVIOR_RULES.md Rule 32, rewritten 2026-05-02).
 * Replaces the now-removed `!killswitch` Discord command.
 *
 * Delegates to set_killswitch.py → auto_trader.killswitch.set_killswitch()
 * so the in-process bot cache busts and `[KILLSWITCH-ON]`/`[KILLSWITCH-OFF]`
 * WARN sentinels are emitted (Observatory still sees every toggle).
 *
 * Responses:
 *   200 — toggled or idempotent no-op (JSON includes prev/new state)
 *   400 — bad request / bad action
 *   500 — internal / DB error
 */
export async function POST(request: Request) {
  let body: { action?: unknown; reason?: unknown; author?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const action = String(body.action ?? "").trim().toLowerCase();
  if (action !== "on" && action !== "off") {
    return NextResponse.json(
      { ok: false, error: "action must be 'on' or 'off'" },
      { status: 400 },
    );
  }
  const reason = String(body.reason ?? "Hub toggle").trim() || "Hub toggle";
  const author = String(body.author ?? "ghost").trim() || "ghost";

  // W-C-P2a: routed through the gateway → VM (audited). The killswitch is the
  // emergency stop — it intentionally has NO write-enable gate (always actionable).
  const gw = await callGateway(
    "killswitch.set",
    { action, reason, author },
    { actor: `hub:${author}`, reason: `killswitch.${action}` },
  );
  // Bust the GET cache so the topbar pill + System Health card see fresh state
  // on the very next poll instead of waiting up to 5s.
  cache.clear();
  return gatewayResponse(gw);
}
