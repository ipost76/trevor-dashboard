import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/auto-trader/scan-status
// Per-ticker scan status for the empty-state pills (5 sacred tickers).
// Sources: signal_cooldowns + active_signal_cards. READ-ONLY.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TickerScanStatus = {
  ticker: string;
  status: "scanning" | "cooldown" | "recent_reject";
  on_cooldown: boolean;
  cooldown_remaining_minutes: number | null;
  cooldown_direction: string | null;
  last_confidence: number | null;
  last_reject_reason: string | null;
  last_scan_at: string | null;
  recent_confidences: Array<{
    ts: string;
    direction: string;
    original: number | null;
    current: number | null;
    peak: number | null;
    removed: string | null;
  }>;
};

type ScanStatusResponse = {
  tickers: TickerScanStatus[];
  queried_at: number;
  error?: string;
};

const FALLBACK: ScanStatusResponse = {
  tickers: [],
  queried_at: 0,
};

let cache: { data: ScanStatusResponse; ts: number } | null = null;
const CACHE_TTL_MS = 30_000; // matches scan loop cadence (3min) but more responsive

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }
  try {
    const raw = runPython("query_auto_trader_scan_status.py", [], {
      timeout: 5_000,
    });
    const data = safeJsonParse<ScanStatusResponse>(raw, FALLBACK);
    cache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ...FALLBACK, error: String(e) },
      { status: 500 }
    );
  }
}
