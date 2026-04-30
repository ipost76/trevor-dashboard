import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/auto/config — D3 consolidated AUTO config view (2026-04-30).
//
// Returns the four config tiles D1's ConfigCard renders + per-ticker
// thresholds (live mirror of ticker_thresholds.py via runtime import).
//
// READ-ONLY. Replaces /api/auto-trader/per-ticker-thresholds + GET side
// of /api/auto-trader/config. PUT side intentionally dropped — config writes
// are CC-prompt + auto_trader/config.py only, never via Hub UI.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Threshold {
  ticker: string;
  tier: "BLUE_CHIP" | "MID_CAP" | "MEME";
  quiet: number;
  normal: number;
  active: number;
}

interface AutoConfigResponse {
  capital_cap_usd: number;
  live_per_trade_usd: number;
  confidence_floor: number;
  max_leverage: number;
  per_ticker_thresholds_enabled: boolean;
  per_ticker_thresholds: Threshold[];
  data_available: boolean;
  error?: string;
}

const FALLBACK: AutoConfigResponse = {
  capital_cap_usd: 50,
  live_per_trade_usd: 10,
  confidence_floor: 35,
  max_leverage: 5,
  per_ticker_thresholds_enabled: false,
  per_ticker_thresholds: [],
  data_available: false,
};

export async function GET() {
  try {
    const raw = runPython("query_auto_config.py", [], { timeout: 5_000 });
    const data = safeJsonParse<AutoConfigResponse>(raw, FALLBACK);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { ...FALLBACK, error: String(err) },
      { status: 200 },
    );
  }
}
