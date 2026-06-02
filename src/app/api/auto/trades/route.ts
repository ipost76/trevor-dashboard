import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";

// GET /api/auto/trades?type=open|closed&limit=N — D3 consolidated trades view.
//
// type=open    -> { type, count, positions: [...] }
// type=closed  -> { type, count, trades: [...] }
//
// limit is clamped to 1..200 (default 10). Both types filter trade_mode='live'.
// READ-ONLY. Replaces /api/auto-trader/history for D1 + open-positions slice
// of /api/auto-trader (base).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TradesResponse {
  type: "open" | "closed";
  count: number;
  positions?: Record<string, unknown>[];
  trades?: Record<string, unknown>[];
  error?: string;
}

// PERF-02: 15s SWR cache, keyed by `${type}:${limit}` so open/closed and each
// limit hold independent entries. concurrency:2 per spec.
const cache = createSwrCache<TradesResponse>({ defaultTtl: 15_000, concurrency: 2 });

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const typeParam = (url.searchParams.get("type") ?? "closed").toLowerCase();
  if (typeParam !== "open" && typeParam !== "closed") {
    return NextResponse.json(
      { error: "type must be 'open' or 'closed'" },
      { status: 400 },
    );
  }
  const type = typeParam as "open" | "closed";
  const limitRaw = Number(url.searchParams.get("limit") ?? 10);
  const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 10));

  const fallback: TradesResponse =
    type === "open"
      ? { type, count: 0, positions: [] }
      : { type, count: 0, trades: [] };

  try {
    // PERF-02 (2026-06-02): was uncached behind a 15s poll. Single-flight + SWR
    // (15s), keyed by type:limit so each distinct view collapses concurrent
    // requests to ONE Python child per window. The try/catch preserves the prior
    // fail-safe (200 + fallback shape) on a cold-cache failure.
    const { value } = await cache.swr(`${type}:${limit}`, async () => {
      const raw = await runPython("query_auto_trades.py", [type, String(limit)], {
        timeout: 5_000,
      });
      return safeJsonParse<TradesResponse>(raw, fallback);
    });
    return NextResponse.json(value);
  } catch (err) {
    return NextResponse.json(
      { ...fallback, error: String(err) },
      { status: 200 },
    );
  }
}
