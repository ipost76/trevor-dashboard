import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/shadow/promotions — PROMOTIONS subtab backend (RM-SHADOW-PROMOTE B2).
//
// Returns the at-a-glance readiness list: shadows the nightly readiness gate
// (built C1, populated by B1's off-loop VM job) flagged 'ready' or 'in_progress'.
// 'removed' rows are filtered out of the active view (kept in the DB as history).
//
// READ-ONLY. The Hub displays only — every state transition is B1's job. The
// query is fail-soft: an empty/missing table returns [] (never 500), so the
// subtab renders its "nothing ready yet" empty-state when B1 hasn't run yet.
//
// Auth: middleware-enforced cookie session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Promotion {
  shadow_name: string;
  description: string | null;
  state: "ready" | "in_progress";
  n_distinct: number | null;
  expectancy_usd: number | null;
  verdict_summary: string | null;
  first_ready_at: string | null;
}

interface PromotionsResponse {
  promotions: Promotion[];
  total: number;
  replica_age_seconds: number | null;
  replica_mtime: string | null;
  error?: string;
}

const FALLBACK: PromotionsResponse = {
  promotions: [],
  total: 0,
  replica_age_seconds: null,
  replica_mtime: null,
};

export async function GET() {
  try {
    const raw = await runPython("query_promotion_ready.py", [], { timeout: 15_000 });
    const data = safeJsonParse<PromotionsResponse>(raw, FALLBACK);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { ...FALLBACK, error: String(err) },
      { status: 200 },
    );
  }
}
