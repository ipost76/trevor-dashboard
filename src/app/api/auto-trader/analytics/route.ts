import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/auto-trader/analytics?mode=all|live|paper
// Aggregated data for the two bar charts + an overall summary, optionally
// filtered to a single trade_mode.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_MODE = new Set(["all", "live", "paper"]);

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
  mode: string;
  error?: string;
};

const fallback = (mode: string): AnalyticsResponse => ({
  by_ticker: [],
  by_exit_reason: [],
  overall: {
    total_trades: 0, wins: 0, losses: 0, win_rate: 0, total_pnl: 0,
    best_trade: null, worst_trade: null,
    avg_hold_minutes: 0, avg_winner_pnl: 0, avg_loser_pnl: 0,
    profit_factor: null,
  },
  mode,
});

// Per-mode cache so toggling between Live/Paper/All doesn't fight one entry.
const cache = new Map<string, { data: AnalyticsResponse; ts: number }>();
const CACHE_TTL_MS = 30_000;

export async function GET(req: NextRequest) {
  const modeRaw = (req.nextUrl.searchParams.get("mode") || "all").toLowerCase();
  const mode = ALLOWED_MODE.has(modeRaw) ? modeRaw : "all";

  const hit = cache.get(mode);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return NextResponse.json(hit.data);
  }
  try {
    const raw = runPython("query_auto_trader_history.py", ["analytics", mode], {
      timeout: 10_000,
    });
    const data = safeJsonParse<AnalyticsResponse>(raw, fallback(mode));
    cache.set(mode, { data, ts: Date.now() });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ...fallback(mode), error: String(e) },
      { status: 500 }
    );
  }
}
