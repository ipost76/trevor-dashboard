import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/auto-trader/history?page=1&limit=20&filter=all|winners|losers&period=7d|30d|all
// Paginated closed trades with full detail for the expandable rows.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_FILTER = new Set(["all", "winners", "losers"]);
const ALLOWED_PERIOD = new Set(["all", "7d", "30d"]);
const MAX_LIMIT = 100;

type ClosedTrade = Record<string, unknown>;

type HistoryResponse = {
  trades: ClosedTrade[];
  total: number;
  page: number;
  pages: number;
  limit: number;
  filter: string;
  period: string;
  has_more: boolean;
  error?: string;
};

const FALLBACK = (page: number, limit: number, filt: string, period: string): HistoryResponse => ({
  trades: [],
  total: 0,
  page,
  pages: 0,
  limit,
  filter: filt,
  period,
  has_more: false,
});

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const pageRaw = parseInt(sp.get("page") || "1", 10);
  const limitRaw = parseInt(sp.get("limit") || "20", 10);
  const filter = sp.get("filter") || "all";
  const period = sp.get("period") || "all";

  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(MAX_LIMIT, limitRaw)
    : 20;
  const safeFilter = ALLOWED_FILTER.has(filter) ? filter : "all";
  const safePeriod = ALLOWED_PERIOD.has(period) ? period : "all";

  try {
    const raw = runPython(
      "query_auto_trader_history.py",
      ["history", String(page), String(limit), safeFilter, safePeriod],
      { timeout: 10_000 }
    );
    const data = safeJsonParse<HistoryResponse>(raw, FALLBACK(page, limit, safeFilter, safePeriod));
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ...FALLBACK(page, limit, safeFilter, safePeriod), error: String(e) },
      { status: 500 }
    );
  }
}
