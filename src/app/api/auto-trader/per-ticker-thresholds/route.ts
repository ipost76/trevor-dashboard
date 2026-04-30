import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/auto-trader/per-ticker-thresholds
// READ-ONLY mirror of `/home/trevor/trevor/ticker_thresholds.py`. Used by
// D1's WatchlistGrid + ConfigCard to show the live per-ticker confidence
// thresholds (quiet/normal/active) alongside the master enabled flag.
//
// Auth: middleware enforces session cookie on all /api/* (except /api/auth,
// /api/health). Fail-safe: any error returns the empty shape with HTTP 200
// so the UI renders a clean fallback instead of crashing.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Threshold {
  ticker: string;
  tier: "BLUE_CHIP" | "MID_CAP" | "MEME";
  quiet: number;
  normal: number;
  active: number;
}

interface ThresholdsResponse {
  enabled: boolean;
  thresholds: Threshold[];
  error?: string;
}

const FALLBACK: ThresholdsResponse = { enabled: false, thresholds: [] };

let cache: { data: ThresholdsResponse; ts: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }
  try {
    const raw = runPython("query_auto_per_ticker_thresholds.py", [], {
      timeout: 5_000,
    });
    const data = safeJsonParse<ThresholdsResponse>(raw, FALLBACK);
    cache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { ...FALLBACK, error: String(err) },
      { status: 200 },
    );
  }
}
