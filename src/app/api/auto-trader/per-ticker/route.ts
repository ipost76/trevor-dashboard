import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/auto-trader/per-ticker?mode=all|live|paper
// Per-ticker performance breakdown for the 5 sacred tickers.
// READ-ONLY pure SQL aggregates over auto_trades.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_MODES = new Set(["all", "live", "paper"]);

type EquityPoint = { x: number; y: number };

type PerTickerStats = {
  ticker: string;
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_pnl: number;
  avg_win: number;
  avg_loss: number;
  best_trade: number;
  worst_trade: number;
  equity_points: EquityPoint[];
};

type PerTickerResponse = {
  tickers: PerTickerStats[];
  mode: string;
  error?: string;
};

const FALLBACK = (mode: string): PerTickerResponse => ({
  tickers: [],
  mode,
});

const cache = new Map<string, { data: PerTickerResponse; ts: number }>();
const CACHE_TTL_MS = 60_000;

export async function GET(req: NextRequest) {
  const modeRaw = (req.nextUrl.searchParams.get("mode") || "all").toLowerCase();
  const mode = ALLOWED_MODES.has(modeRaw) ? modeRaw : "all";

  const hit = cache.get(mode);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return NextResponse.json(hit.data);
  }
  try {
    const raw = runPython("query_auto_trader_per_ticker.py", [mode], {
      timeout: 8_000,
    });
    const data = safeJsonParse<PerTickerResponse>(raw, FALLBACK(mode));
    cache.set(mode, { data, ts: Date.now() });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ...FALLBACK(mode), error: String(e) },
      { status: 500 }
    );
  }
}
