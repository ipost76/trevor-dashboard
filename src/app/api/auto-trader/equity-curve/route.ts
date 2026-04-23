import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/auto-trader/equity-curve
// Chronological equity snapshots — one point per closed trade.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type EquityResponse = {
  points: Array<{
    trade_id: number;
    ticker: string;
    direction: string;
    pnl_usd: number;
    closed_at: string;
    equity: number;
    pnl_cumulative: number;
  }>;
  starting_capital: number;
  current_equity: number;
  total_trades: number;
  error?: string;
};

let cache: { data: EquityResponse; ts: number } | null = null;
const CACHE_TTL_MS = 30_000;

const FALLBACK: EquityResponse = {
  points: [],
  starting_capital: 50,
  current_equity: 50,
  total_trades: 0,
};

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }
  try {
    const raw = runPython("query_auto_trader_history.py", ["equity-curve"], {
      timeout: 10_000,
    });
    const data = safeJsonParse<EquityResponse>(raw, FALLBACK);
    cache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ...FALLBACK, error: String(e) },
      { status: 500 }
    );
  }
}
