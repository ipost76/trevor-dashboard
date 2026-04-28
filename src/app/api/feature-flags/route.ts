import { NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/feature-flags
 * Returns the current state of all HUB_REDESIGN_* flags from auto_config.
 *
 * Response shape:
 *   { flags: { HUB_REDESIGN_NAV: { value: false, updated_at: "..." }, ... } }
 *
 * Fail-safe: any error returns { flags: {}, error: "...", fallback: "all_off" }
 * so the Hub renders the old layout.
 */
export async function GET() {
  try {
    const stdout = await runPython("query_feature_flags.py", []);
    const data = JSON.parse(stdout);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({
      flags: {},
      error: String(err),
      fallback: "all_off",
    });
  }
}
