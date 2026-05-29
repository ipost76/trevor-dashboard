import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/auto/state — D3 consolidated AUTO state (2026-04-30).
//
// Returns capital, equity, today's P&L (live only), open positions count,
// auto/live/killswitch flags, per-ticker thresholds enabled flag.
//
// READ-ONLY. Replaces /api/auto-trader (base) for D1 components.
// Auth: middleware enforces session cookie on all /api/* (except /auth, /health).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AutoStateResponse {
  capital_usd: number;
  live_capital_usd: number;
  equity: number;
  pnl_today_usd: number;
  pnl_today_pct: number;
  trades_today: number;
  open_positions_count: number;
  auto_enabled: boolean;
  live_enabled: boolean;
  killswitch_on: boolean;
  per_ticker_thresholds_enabled: boolean;
  data_available: boolean;
  error?: string;
}

const FALLBACK: AutoStateResponse = {
  capital_usd: 0,
  live_capital_usd: 0,
  equity: 0,
  pnl_today_usd: 0,
  pnl_today_pct: 0,
  trades_today: 0,
  open_positions_count: 0,
  auto_enabled: false,
  live_enabled: false,
  killswitch_on: false,
  per_ticker_thresholds_enabled: false,
  data_available: false,
};

export async function GET() {
  try {
    // RM-07 P00 (2026-05-28): timeout bumped 5s → 10s to absorb the live HL
    // info.user_state() round-trip (typical 3-5s cold, sub-1s warm).
    const raw = await runPython("query_auto_state.py", [], { timeout: 10_000 });
    const data = safeJsonParse<AutoStateResponse>(raw, FALLBACK);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { ...FALLBACK, error: String(err) },
      { status: 200 },
    );
  }
}
