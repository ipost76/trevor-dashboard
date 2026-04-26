import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/auto-trader/equity-curve
// Chronological equity snapshots — one point per closed trade.
// 2026-04-26: each point now carries trade_mode + per-mode running totals
// (live_equity / paper_equity) so the chart can render two series.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Point = {
  trade_id: number;
  ticker: string;
  direction: string;
  trade_mode: "live" | "paper";
  pnl_usd: number;
  closed_at: string;
  equity: number;
  live_equity: number;
  paper_equity: number;
  pnl_cumulative: number;
};

type EquityResponse = {
  points: Point[];
  starting_capital: number;
  current_equity: number;
  current_equity_live: number;
  current_equity_paper: number;
  total_trades: number;
  live_count: number;
  paper_count: number;
  error?: string;
};

let cache: { data: EquityResponse; ts: number } | null = null;
const CACHE_TTL_MS = 30_000;

const FALLBACK: EquityResponse = {
  points: [],
  starting_capital: 50,
  current_equity: 50,
  current_equity_live: 50,
  current_equity_paper: 50,
  total_trades: 0,
  live_count: 0,
  paper_count: 0,
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
