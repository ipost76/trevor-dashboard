import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// C1 (2026-04-29): Hero PnL aggregation. Replaces dashboard's reads of
// /api/admin/current-state + /api/trade-stats + /api/auto-trader/equity-curve
// with a single consolidated endpoint. system in {auto, degen, scalp};
// range in {today, 7d, 30d, lifetime}. DEGEN returns data_available:false stub.
//
// runPython is synchronous (spawnSync) — no await needed.

const ALLOWED_SYSTEMS = new Set(["auto", "degen", "scalp"]);
const ALLOWED_RANGES = new Set(["today", "7d", "30d", "lifetime"]);

function emptyShape(system: string, range: string, error: string) {
  return {
    system,
    range,
    total_pnl_pct: 0,
    total_pnl_usd: 0,
    wins: 0,
    losses: 0,
    win_rate: 0,
    streak: 0,
    trade_count: 0,
    equity_series: [],
    data_available: false,
    message: error,
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const system = (url.searchParams.get("system") ?? "auto").toLowerCase();
  const range = (url.searchParams.get("range") ?? "7d").toLowerCase();

  if (!ALLOWED_SYSTEMS.has(system) || !ALLOWED_RANGES.has(range)) {
    return NextResponse.json({ error: "invalid system or range" }, { status: 400 });
  }

  try {
    const stdout = runPython("query_dashboard_pnl.py", [system, range], { timeout: 8000 });
    const data = safeJsonParse(stdout, emptyShape(system, range, "parse error"));
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(emptyShape(system, range, String(err)), { status: 200 });
  }
}
