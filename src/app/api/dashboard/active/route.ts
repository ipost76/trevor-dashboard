import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// C1 (2026-04-29): Cross-system active position aggregation. Replaces
// the dashboard's reliance on /api/live (open snapshot) + /api/auto-trader
// (live open positions). Live prices NOT joined here — client zips with
// /api/prices to keep slow SQL aggregation decoupled from fast price polling.

interface ActiveResponse {
  count: number;
  positions: unknown[];
  error?: string;
}

const FALLBACK: ActiveResponse = { count: 0, positions: [] };

export async function GET() {
  try {
    const stdout = runPython("query_dashboard_active.py", [], { timeout: 6000 });
    const data = safeJsonParse<ActiveResponse>(stdout, FALLBACK);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ ...FALLBACK, error: String(err) }, { status: 200 });
  }
}
