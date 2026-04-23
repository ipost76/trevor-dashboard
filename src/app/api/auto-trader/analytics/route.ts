import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/auto-trader/analytics
// Aggregated data for the two bar charts + an overall summary.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TickerRow = {
  ticker: string;
  total: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_pnl: number;
  avg_pnl_pct: number;
};

type ExitReasonRow = {
  reason: string;
  count: number;
  total_pnl: number;
  avg_pnl_pct: number;
  color: string;
};

type Overall = {
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_pnl: number;
  best_trade: { id: number; ticker: string; direction: string; pnl_usd: number; pnl_pct: number } | null;
  worst_trade: { id: number; ticker: string; direction: string; pnl_usd: number; pnl_pct: number } | null;
  avg_hold_minutes: number;
  avg_winner_pnl: number;
  avg_loser_pnl: number;
  profit_factor: number | null;
};

type AnalyticsResponse = {
  by_ticker: TickerRow[];
  by_exit_reason: ExitReasonRow[];
  overall: Overall;
  error?: string;
};

const FALLBACK: AnalyticsResponse = {
  by_ticker: [],
  by_exit_reason: [],
  overall: {
    total_trades: 0, wins: 0, losses: 0, win_rate: 0, total_pnl: 0,
    best_trade: null, worst_trade: null,
    avg_hold_minutes: 0, avg_winner_pnl: 0, avg_loser_pnl: 0,
    profit_factor: null,
  },
};

let cache: { data: AnalyticsResponse; ts: number } | null = null;
const CACHE_TTL_MS = 30_000;

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }
  try {
    const raw = runPython("query_auto_trader_history.py", ["analytics"], {
      timeout: 10_000,
    });
    const data = safeJsonParse<AnalyticsResponse>(raw, FALLBACK);
    cache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ...FALLBACK, error: String(e) },
      { status: 500 }
    );
  }
}
