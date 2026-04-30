import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMPTY = {
  today_signals: 0,
  avg_confidence: 0,
  long_pct: 0,
  short_pct: 0,
  lifetime_xp: 0,
  data_available: false,
};

export async function GET() {
  try {
    const stdout = runPython("query_dashboard_quick_stats.py", [], { timeout: 8000 });
    return NextResponse.json(safeJsonParse(stdout, EMPTY));
  } catch (err) {
    return NextResponse.json({ ...EMPTY, error: String(err) }, { status: 200 });
  }
}
