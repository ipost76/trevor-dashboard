import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/shadow/promotions — PROMOTIONS subtab backend (RM-SHADOW-PROMOTE B2/B4).
//
// Ghost's two-sided worklist: shadows B3's nightly gate SURFACED — promote
// candidates (state='ready') + cull candidates (state='removed'). Accruing
// shadows (the auto-stamped in_progress flood) are filtered out at the source
// (query_promotion_ready.py: WHERE surfaced=1, else state IN ('ready','removed')).
//
// READ-ONLY. The Hub displays only — every state transition + the surfaced flag
// is B3's VM job. Fail-soft: an empty/missing table (or missing surfaced column
// pre-B3) returns [] (never 500), so the subtab renders its friendly empty-state.
//
// Auth: middleware-enforced cookie session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Promotion {
  shadow_name: string;
  description: string | null;
  state: "ready" | "in_progress" | "removed";
  n_distinct: number | null;
  expectancy_usd: number | null;
  verdict_summary: string | null;
  first_ready_at: string | null;
  updated_at: string | null;
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
