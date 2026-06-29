import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { timingSafeEqual } from "node:crypto";
import { runPython } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";
import { callGateway, gatewayResponse } from "@/lib/gateway-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * B5 (2026-06-28): read DASHBOARD_PASS from .env.local directly — the SAME
 * source the login uses (mirrors auth/route.ts `getCredentials`), so the
 * killswitch password gate tracks the same live password as login after a
 * rotation (no restart, no desync). Falls back to process.env. Never logged.
 */
function getDashboardPass(): string {
  try {
    const envPath = join(process.cwd(), ".env.local");
    const content = readFileSync(envPath, "utf-8");
    const passMatch = content.match(/^DASHBOARD_PASS=(.+)$/m);
    return passMatch ? passMatch[1].trim() : process.env.DASHBOARD_PASS || "";
  } catch {
    return process.env.DASHBOARD_PASS || "";
  }
}

/**
 * Constant-time password compare for the killswitch gate.
 *
 * Pure (no .env read — both values passed in) so it can be unit-tested at the
 * function level without POSTing the live route. Fails CLOSED:
 *  - empty submitted OR empty stored → false (never authorize on an empty
 *    configured pass — timingSafeEqual("","") would otherwise return true).
 *  - length mismatch → false, returned BEFORE timingSafeEqual (which THROWS on
 *    differing buffer lengths), so a length difference can never throw/500.
 * Equal non-empty lengths → timingSafeEqual byte compare (no early-exit timing
 * side-channel).
 */
function passwordsMatch(submitted: string, stored: string): boolean {
  if (submitted.length === 0 || stored.length === 0) return false;
  const a = Buffer.from(submitted, "utf8");
  const b = Buffer.from(stored, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

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
  let body: { action?: unknown; reason?: unknown; author?: unknown; password?: unknown } = {};
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

  // B5 (2026-06-28): server-verified password re-confirm before the emergency
  // stop fires — so a casual viewer holding a Hub session can't trip it. Read
  // DASHBOARD_PASS from .env.local directly (mirrors login) so it tracks the
  // same live password after a rotation. Fail CLOSED — missing/empty/mismatch →
  // 401, gateway NEVER called, password NEVER logged. Additive gating only: the
  // killswitch stays fully functional on the correct password (emergency stop
  // is NOT weakened).
  const password = String(body.password ?? "");
  const dashboardPass = getDashboardPass();
  // KILLSWITCH-TIMING-SAFE: constant-time compare with length guard (fail-closed
  // — empty/length-mismatch/mismatch → same 401, never a throw). Reject body is
  // byte-identical to the prior plain-=== path.
  if (!passwordsMatch(password, dashboardPass)) {
    return NextResponse.json(
      { ok: false, error: "Invalid or missing password" },
      { status: 401 },
    );
  }

  // W-C-P2a: routed through the gateway → VM (audited). Transport is unchanged;
  // the password gate above is the new barrier in front of it.
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
