import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMPTY = {
  expectancy_pct: 0,
  win_loss_ratio: 0,
  avg_win_pct: 0,
  avg_loss_pct: 0,
  best_pct: 0,
  worst_pct: 0,
  asymmetric: false,
  sample_n: 0,
  data_available: false,
  message: "Edge query failed.",
};

export async function GET() {
  try {
    const stdout = runPython("query_dashboard_edge.py", [], { timeout: 8000 });
    return NextResponse.json(safeJsonParse(stdout, EMPTY));
  } catch (err) {
    return NextResponse.json({ ...EMPTY, message: String(err) }, { status: 200 });
  }
}
