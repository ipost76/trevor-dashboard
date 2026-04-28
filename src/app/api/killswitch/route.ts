import { NextResponse } from "next/server";
import { execSync } from "child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 5-second cache matches the client poll cadence in KillswitchPill.tsx
// — coalesces multi-tab requests, keeps Python spawn rate to <1/sec.
let _cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL = 5_000;

/**
 * GET /api/killswitch
 * Returns { enabled, lastToggle, lastAuthor, lastReason }.
 *
 * READ-ONLY. There is no POST. Toggling happens via Discord !killswitch on/off.
 * Auth via session cookie middleware (inherited from /api/* protection).
 *
 * Fail-safe: on Python helper or DB error, returns 500 with
 * { enabled: false, error: "..." } so the KillswitchPill stays hidden
 * (visual fail-safe — never falsely shows STANDBY when DB unreachable).
 */
export async function GET() {
  try {
    const now = Date.now();
    if (_cache && now - _cache.ts < CACHE_TTL) {
      return NextResponse.json(_cache.data);
    }
    const raw = execSync(
      "/home/trevor/trevor/venv/bin/python /home/trevor/trevor-dashboard/query_killswitch_state.py",
      { timeout: 5_000, encoding: "utf-8" }
    );
    const data = JSON.parse(raw);
    _cache = { data, ts: now };
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { enabled: false, error: String(e) },
      { status: 500 }
    );
  }
}
