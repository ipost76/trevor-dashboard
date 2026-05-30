import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/shadow/compare — S3-P07 (Intel→Promote panel) backend.
//
// Read-only would-be-vs-actual roll-up across the six Stage-2/3 shadow
// overlays, with a per-overlay promote-readiness verdict. Each overlay logs
// its own table; query_shadow_compare.py reads each `?mode=ro` and shapes
// the summary. Payload shape is documented in that script.
//
// HONESTY: overlays below MIN_SAMPLES resolved-divergent decisions report
// readiness="insufficient_data" with null metrics (never a fabricated
// number). Overlay #6 (S3-P06, built in parallel) reports "not_reporting"
// until its shadow table appears, then lights up with no coupling.
//
// NEVER sends commands — GET only. Auth: middleware-enforced cookie session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Readiness =
  | "insufficient_data"
  | "not_reporting"
  | "underperforms"
  | "candidate";

interface OverlayRecentRow {
  created_at: string | null;
  ticker: string | null;
  direction: string | null;
  would_be: string | null;
  live: string | null;
  divergent: boolean;
  outcome: number | null;
  helped: boolean | null;
}

interface OverlaySummary {
  key: string;
  table: string;
  display: string;
  stage: string;
  function: "Entry" | "Exit" | "Scoring" | "Risk" | "Data";
  present: boolean;
  decisions_total: number;
  decisions_7d: number;
  resolved: number;
  divergent: number;
  divergent_resolved: number;
  helped_pct: number | null;
  est_pnl_delta: number | null;
  delta_unit: "R" | null;
  metric_basis: string;
  latest_write: string | null;
  readiness: Readiness;
  readiness_note: string;
  recent: OverlayRecentRow[];
  error?: string;
}

interface ShadowCompareResponse {
  min_samples: number;
  overlays: OverlaySummary[];
  summary: Record<Readiness, number>;
  error?: string;
}

const FALLBACK: ShadowCompareResponse = {
  min_samples: 20,
  overlays: [],
  summary: {
    candidate: 0,
    underperforms: 0,
    insufficient_data: 0,
    not_reporting: 0,
  },
};

export async function GET() {
  try {
    const raw = await runPython("query_shadow_compare.py", [], { timeout: 12_000 });
    const data = safeJsonParse<ShadowCompareResponse>(raw, FALLBACK);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { ...FALLBACK, error: String(err) },
      { status: 200 },
    );
  }
}
