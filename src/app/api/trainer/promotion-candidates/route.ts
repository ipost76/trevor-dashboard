import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/trainer/promotion-candidates — TRAINER page · "promotions" PRIMARY
// surface (R12-B1). Reads R8's promotion_candidates (config diff + stats +
// reasoning) via query_promotion_candidates.py (replica, mode=ro). ABSENT until
// cutover → empty shape (never 500). READ-ONLY display; the approve/reject write
// rides the gateway (promotion.approve, Phase 2), never this route.
//
// 🚨 NOT the legacy promotion_ready readiness gate (that stays a SEPARATE
// secondary view via /api/shadow/promotions). Never conflate the two.
// Auth: middleware-enforced cookie session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// promotion_candidates is R8-owned + absent pre-cutover, so the reader SELECT *s
// and each candidate is a flexible column map (candidate_id/shadow_id stable).
type Candidate = Record<string, unknown> & {
  candidate_id: string | null;
  shadow_id: string | null;
};

interface CandidatesResponse {
  status: "ok" | "no_data_yet";
  candidates: Candidate[];
  count: number;
  // ADVISORY UI gate (HUB_PROMOTION_WRITE_ENABLED from the replica auto_config).
  // The VM gateway is authoritative (423 when off) — this only decides whether
  // the approve/reject control renders actionable or read-only.
  write_enabled: boolean;
  replica_age_seconds: number | null;
  replica_mtime: string | null;
  error?: string;
}

const FALLBACK: CandidatesResponse = {
  status: "no_data_yet",
  candidates: [],
  count: 0,
  write_enabled: false,
  replica_age_seconds: null,
  replica_mtime: null,
};

export async function GET() {
  try {
    const raw = await runPython("query_promotion_candidates.py", [], { timeout: 15_000 });
    return NextResponse.json(safeJsonParse<CandidatesResponse>(raw, FALLBACK));
  } catch (err) {
    // B3 — same shape as `watcher/integrity`: status 200 and the FALLBACK
    // shape preserved, only the VALUE swapped raw→code. This component never
    // reads `error` at all (it is declared on the type and nowhere else), so
    // nothing on screen changes; the point is that the raw exception no longer
    // sits in client state waiting for the next consumer to render it.
    console.error("[trainer/promotion-candidates] reader failed:", err);
    return NextResponse.json(
      { ...FALLBACK, error: "reader_failed", error_code: "reader_failed" },
      { status: 200 },
    );
  }
}
