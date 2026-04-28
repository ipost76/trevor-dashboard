import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/auto-trader/slippage
// Last 100 entries from slippage_audit, oldest → newest. Used by the
// SlippageHistogram on AutoTrader's analytics row. 60s cache (slippage
// data lands per fill; not a hot path).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SlippageRow = {
  id: number;
  trade_id: number | null;
  ticker: string;
  direction: string | null;
  planned_price: number;
  actual_price: number;
  slippage_bps: number;
  slippage_pct: number;
  impact_usd: number | null;
  alerted: number;
  created_at: string;
};

type SlippageResponse = {
  rows: SlippageRow[];
  total: number;
  summary: {
    n: number;
    avg_bps: number;
    p50_bps: number;
    p95_bps: number;
    max_bps: number;
    alerted_count: number;
  };
  error?: string;
};

const FALLBACK: SlippageResponse = {
  rows: [],
  total: 0,
  summary: { n: 0, avg_bps: 0, p50_bps: 0, p95_bps: 0, max_bps: 0, alerted_count: 0 },
};

let cache: { data: SlippageResponse; ts: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(500, parseInt(limitParam, 10) || 100)) : 100;

  if (cache && Date.now() - cache.ts < CACHE_TTL_MS && cache.data.rows.length > 0) {
    return NextResponse.json(cache.data);
  }
  try {
    const raw = runPython("query_auto_trader_slippage.py", [String(limit)], { timeout: 8_000 });
    const data = safeJsonParse<SlippageResponse>(raw, FALLBACK);
    cache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ ...FALLBACK, error: String(e) }, { status: 500 });
  }
}
