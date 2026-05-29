import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/auto/profit-risk — S1-P06 read-only Profit-Taking + Risk feed.
//
// Backs the Hub "Profit-Taking + Risk" panel (Auto → Dashboard tab). Returns,
// for each OPEN live trade, its Stage-1 exit posture (breakeven armed?, ratchet
// floor R, partials taken + realized partial P&L, intended risk $/%), plus the
// consolidated circuit-breaker state (entries allowed?, active breakers, each
// breaker's reading vs its limit).
//
// READ-ONLY. There is NO write surface here — the panel never sends commands to
// the bot. Backed by query_profit_risk.py which reads auto_trades (sqlite RO)
// and circuit_breaker.CircuitBreakerSystem().get_status(). Auth:
// middleware-enforced cookie session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface OpenTrade {
  id: number;
  ticker: string;
  direction: string;
  entry_price: number | null;
  stop_price: number | null;
  target_price: number | null;
  leverage: number | null;
  notional_usd: number | null;
  original_notional_usd: number | null;
  opened_at: string | null;
  peak_pnl_pct: number | null;
  breakeven_armed: boolean;
  ratchet_locked_r: number;
  partials_taken: number;
  partial_pnl_realized: number;
  risk_dollars: number | null;
  risk_pct: number | null;
}

interface BreakerGauge {
  key: string;
  label: string;
  status: "OK" | "YELLOW" | "RED";
  value: number;
  limit: number;
  unit: string;
}

interface ActiveBreaker {
  key: string;
  label: string;
  status: string;
  detail: string;
}

interface BreakerState {
  overall_status: "GREEN" | "YELLOW" | "RED" | "UNKNOWN";
  override_active: boolean;
  entries_allowed: boolean;
  active: ActiveBreaker[];
  all: BreakerGauge[];
  error?: string;
}

interface ProfitRiskResponse {
  data_available: boolean;
  ts: number;
  open_count: number;
  open_trades: OpenTrade[];
  breakers: BreakerState;
  error?: string;
}

const FALLBACK: ProfitRiskResponse = {
  data_available: false,
  ts: 0,
  open_count: 0,
  open_trades: [],
  breakers: {
    overall_status: "UNKNOWN",
    override_active: false,
    entries_allowed: false,
    active: [],
    all: [],
  },
};

// The helper spawns a bot-side python import (circuit_breaker) + an sqlite read.
// Cache briefly so the panel's poll interval can't stampede the bridge.
let _cache: { data: ProfitRiskResponse; ts: number } | null = null;
const CACHE_TTL = 10_000; // 10s

export async function GET() {
  try {
    const now = Date.now();
    if (_cache && now - _cache.ts < CACHE_TTL) {
      return NextResponse.json(_cache.data);
    }

    const raw = await runPython("query_profit_risk.py", [], { timeout: 12_000 });
    const data = safeJsonParse<ProfitRiskResponse>(raw, FALLBACK);
    _cache = { data, ts: now };
    return NextResponse.json(data);
  } catch (e) {
    // Fail-safe: never 500 the panel. Serve last-good if we have it.
    if (_cache) return NextResponse.json(_cache.data);
    return NextResponse.json(
      { ...FALLBACK, error: String(e) },
      { status: 200 },
    );
  }
}
