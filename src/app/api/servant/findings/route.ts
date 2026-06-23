import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/servant/findings — SERVANT edge-hunter ranked findings (B5, read-side)
//
// Lists servant_findings WHERE handled=0, ranked best-first (rank_score DESC),
// backing the SERVANT zone (/servant). READ-ONLY over the litestream replica via
// query_servant_findings.py (mode=ro) — never writes. The $ is realized_dollars
// (the engine's DEDUP'd per-distinct-trade Σ, never a raw row-sum).
//
// The reset WRITE path is a SEPARATE route (POST /api/servant/reset) that targets
// the VM LIVE db over `ssh vm`, never the replica.
//
// Auth-gated by middleware.ts like every other /api/* route.
// ─────────────────────────────────────────────────────────────────────────────

interface Finding {
  id: number;
  created_at: number | null;
  rank_score: number | null;
  dimension: string | null;
  title: string | null;
  description: string | null;
  evidence: Record<string, unknown> | null;
  realized_dollars: number | null;
  n_distinct_trades: number | null;
  confidence: string | null;
  job: string | null;
}

interface ServantFindingsResponse {
  findings: Finding[];
  window_start_at: number | null;
  last_report_at: number | null;
  generated_at: number | null;
  open_count: number;
  replica_age_seconds: number | null;
  replica_mtime: string | null;
  error: string | null;
}

const FALLBACK: ServantFindingsResponse = {
  findings: [],
  window_start_at: null,
  last_report_at: null,
  generated_at: null,
  open_count: 0,
  replica_age_seconds: null,
  replica_mtime: null,
  error: null,
};

export async function GET() {
  try {
    const raw = await runPython("query_servant_findings.py", ["list"], { timeout: 8_000 });
    const data = safeJsonParse<ServantFindingsResponse>(raw, FALLBACK);
    return NextResponse.json(data);
  } catch (e) {
    // Fail-soft: never 500 the page — return the empty shape with the error noted.
    return NextResponse.json({ ...FALLBACK, error: String(e) });
  }
}
