import { NextResponse } from "next/server";
import { getAllFlagsCached } from "@/lib/feature-flags-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/feature-flags
 * Returns the current state of all HUB_REDESIGN_* flags from auto_config.
 *
 * Response shape:
 *   { flags: { HUB_REDESIGN_NAV: { value: false, updated_at: "..." }, ... } }
 *
 * PERF-03 (2026-06-02): reads through the shared `getAllFlagsCached` so this
 * route shares the SSR sites' single flag-read path. (This is a standalone HTTP
 * request, so it's outside the per-render dedup — same spawn, one code path.)
 * The reader is fail-safe (returns {} on any error → all flags off → old
 * layout), so this route can never 500 on a flag read.
 */
export async function GET() {
  const flags = await getAllFlagsCached();
  return NextResponse.json({ flags });
}
