import { NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";

// GET /api/auto/config — D3 consolidated AUTO config view (2026-04-30).
//
// Returns the four config tiles D1's ConfigCard renders + per-ticker
// thresholds + margin_mode (live mirror of the VM-only ticker_thresholds.py +
// auto_trader.config, re-sourced by query_auto_config.py over the read-only
// `ssh vm` pipe — B2-WATCHLIST-RESOURCE, mirroring query_wedge-metrics).
//
// READ-ONLY. Replaces /api/auto-trader/per-ticker-thresholds + GET side
// of /api/auto-trader/config. PUT side intentionally dropped — config writes
// are CC-prompt + auto_trader/config.py only, never via Hub UI.
//
// ~20s SWR + single-flight cache so the two consumers' polls (watchlist-grid
// 30s + config-card 60s) never spawn one ssh-vm per request — concurrent misses
// collapse to a single remote read. runPython timeout is 12s (was 5s, sized for
// a LOCAL sqlite read) so a cold ssh (~5.5s observed) fits comfortably; the old
// 5s budget would have killed a cold ssh AND lost the real DB knobs. An
// unparseable/killed helper THROWS so SWR keeps serving the last-good config
// rather than caching a blank FALLBACK; a cold error surfaces as FALLBACK, 200.

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
  capital_cap_usd: number;     // RM-07 P00 — vestigial; cap removed
  margin_mode: string;         // RM-07 P00 — "isolated" mandatory
  live_per_trade_usd: number;
  confidence_floor: number;
  max_leverage: number;
  per_ticker_thresholds_enabled: boolean;
  per_ticker_thresholds: Threshold[];
  data_available: boolean;
  error?: string;
}

const FALLBACK: AutoConfigResponse = {
  capital_cap_usd: 0,
  margin_mode: "isolated",
  live_per_trade_usd: 10,
  confidence_floor: 35,
  max_leverage: 5,
  per_ticker_thresholds_enabled: false,
  per_ticker_thresholds: [],
  data_available: false,
};

const cache = createSwrCache<AutoConfigResponse>({ defaultTtl: 20_000, concurrency: 1 });

async function readConfig(): Promise<AutoConfigResponse> {
  const raw = await runPython("query_auto_config.py", [], { timeout: 12_000 });
  try {
    return JSON.parse(raw) as AutoConfigResponse;
  } catch {
    // Unparseable/empty helper output — throw so SWR keeps serving the last-good
    // config instead of caching a blank FALLBACK. (A degraded-but-valid payload —
    // e.g. empty thresholds when ssh vm fails — parses fine and is cached, then
    // self-heals on the next miss; the DB knobs in it are still real.)
    throw new Error("query_auto_config.py returned unparseable output");
  }
}

export async function GET() {
  try {
    const data = (await cache.swr("auto-config", readConfig)).value;
    return NextResponse.json(data);
  } catch (err) {
    // Cold error (no last-good) or a runPython throw — FALLBACK, never a 500.
    return NextResponse.json(
      { ...FALLBACK, error: String(err) },
      { status: 200 },
    );
  }
}
