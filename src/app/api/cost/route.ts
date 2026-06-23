import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cost — the Hub Cost CARD read path (B4).
//
// Reads the cost_snapshots CACHE (data/hub.db) ONLY — never BigQuery on page load
// (a per-view BigQuery query costs money + is slow). The daily refresh worker
// (POST /api/cost/refresh) populates the cache; query_cost.py rolls it up into
// month-to-date total + per-service breakdown + linear month-end forecast +
// 30-day daily history. Session-gated by middleware.ts like every other data
// route (only /api/cost/refresh is allow-listed). Fail-soft: never 500s the page.
// ─────────────────────────────────────────────────────────────────────────────

interface Breakdown {
  service: string;
  net_usd: number;
}
interface HistPoint {
  date: string;
  net_usd: number;
}
interface CostResponse {
  status: "ok" | "no_data_yet";
  month_label: string | null;
  mtd_total_usd: number;
  mtd_gross_usd: number;
  days_elapsed: number;
  days_in_month: number;
  projected_month_end_usd: number;
  last_month_total_usd: number | null;
  mom_pct: number | null;
  breakdown: Breakdown[];
  history: HistPoint[];
  fetched_at: string | null;
  reason?: string;
  error?: string;
}

const FALLBACK: CostResponse = {
  status: "no_data_yet",
  month_label: null,
  mtd_total_usd: 0,
  mtd_gross_usd: 0,
  days_elapsed: 0,
  days_in_month: 0,
  projected_month_end_usd: 0,
  last_month_total_usd: null,
  mom_pct: null,
  breakdown: [],
  history: [],
  fetched_at: null,
};

export async function GET() {
  try {
    const raw = await runPython("scripts/db/query_cost.py", [], { timeout: 8_000 });
    return NextResponse.json(safeJsonParse<CostResponse>(raw, FALLBACK));
  } catch (e) {
    // Fail-soft — never 500 the Health page; render the empty state instead.
    return NextResponse.json({ ...FALLBACK, reason: "exception", error: String(e) });
  }
}
