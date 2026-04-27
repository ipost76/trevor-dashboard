import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/auto-trader/activity?limit=50&filter=all|live|trades|rejections&since=<iso>
// Real-time activity feed combining trade events + signal accept/reject from
// auto_trades + active_signal_cards. READ-ONLY.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_FILTERS = new Set(["all", "live", "trades", "rejections"]);
const MAX_LIMIT = 200;

type ActivityEvent = {
  id: string;
  timestamp: string;
  type: string;
  ticker: string;
  detail: string;
  trade_mode: string | null;
};

type ActivityResponse = {
  events: ActivityEvent[];
  queried_at: number;
  filter: string;
  error?: string;
};

const FALLBACK = (filt: string): ActivityResponse => ({
  events: [],
  queried_at: 0,
  filter: filt,
});

// 10-second cache per (limit, filter, since) tuple — short TTL since
// the feed should feel real-time.
const cache = new Map<string, { data: ActivityResponse; ts: number }>();
const CACHE_TTL_MS = 10_000;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limitRaw = parseInt(sp.get("limit") || "50", 10);
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(MAX_LIMIT, limitRaw)
      : 50;
  const filterRaw = (sp.get("filter") || "all").toLowerCase();
  const safeFilter = ALLOWED_FILTERS.has(filterRaw) ? filterRaw : "all";
  const since = (sp.get("since") || "").trim();
  // Sanity — must look like ISO format if provided
  const safeSince =
    since && (since.includes("T") || since.includes(" ")) ? since : "";

  const key = `${limit}|${safeFilter}|${safeSince}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return NextResponse.json(hit.data);
  }

  try {
    const args = [String(limit), safeSince, safeFilter];
    const raw = runPython("query_auto_trader_activity.py", args, {
      timeout: 5_000,
    });
    const data = safeJsonParse<ActivityResponse>(raw, FALLBACK(safeFilter));
    cache.set(key, { data, ts: Date.now() });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ...FALLBACK(safeFilter), error: String(e) },
      { status: 500 }
    );
  }
}
