import { NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";

// /api/shadow/partials — Read-only aggregations over partial_trigger_shadow
// (B4, 2026-05-27). Drives the Partial Exit Shadow card on /autotrader.
// Payload shape documented in query_partial_shadow.py.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stdout = await runPython("query_partial_shadow.py", []);
    return NextResponse.json(JSON.parse(stdout));
  } catch (err) {
    return NextResponse.json(
      {
        summary: {
          rows_24h: 0,
          rows_7d: 0,
          would_fire_24h: 0,
          would_fire_7d: 0,
          near_miss_24h: 0,
          near_miss_7d: 0,
          modes: {},
          would_have_profit_usd_7d: 0,
          live_partials_enabled: false,
        },
        by_level: [],
        by_ticker: [],
        recent: [],
        error: String(err),
      },
      { status: 200 },
    );
  }
}
