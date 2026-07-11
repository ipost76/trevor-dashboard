import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/memory/intel — Memory & Intelligence (glance) backend.
//
// Backs the single-view /memory zone (RM-HUB-INTEL B2) that replaced the old
// 4 raw MEMORY sub-tabs (brain / memory / chromadb / aggressive). Returns a
// quick-glance roll-up of the learning loops from `loop_health`: per-loop
// stage (shadow|probation|live) + verdict (RED|GREEN|YELLOW) + a one-line
// summary, plus stage/verdict rollups and the C1b readiness card.
//
// READ-ONLY. query_loop_health.py opens the replica `mode=ro`, parses
// evidence_json Python-side, and NEVER emits the raw blob. Deep Gate-2 stats
// live on the Health page; shadow-table inventory on Intel/Shadows.
//
// Auth: middleware-enforced cookie session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LoopHealth {
  loop_name: string;
  stage: "shadow" | "probation" | "live";
  verdict: "RED" | "GREEN" | "YELLOW";
  verdict_reason: string;
  pass_streak: number | null;
  summary: string;
  updated_at: string | null;
}

interface C1bCard {
  present: boolean;
  loop_name: string;
  verdict: string;
  n_obs: number | null;
  n_bar: number | null;
  count_met: boolean;
  span_days: number | null;
  span_bar: number | null;
  time_met: boolean;
  criteria: Record<string, boolean>;
  criteria_met: number;
  criteria_total: number;
  ready_for_review: boolean;
  note: string | null;
}

interface MemoryIntelResponse {
  loops: LoopHealth[];
  stage_counts: Record<string, number>;
  verdict_counts: Record<string, number>;
  total: number;
  c1b: C1bCard | null;
  replica_age_seconds: number | null;
  replica_mtime: string | null;
  error?: string;
}

const FALLBACK: MemoryIntelResponse = {
  loops: [],
  stage_counts: {},
  verdict_counts: {},
  total: 0,
  c1b: null,
  replica_age_seconds: null,
  replica_mtime: null,
};

export async function GET() {
  try {
    const raw = await runPython("query_loop_health.py", [], { timeout: 8_000 });
    const data = safeJsonParse<MemoryIntelResponse>(raw, FALLBACK);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { ...FALLBACK, error: String(err) },
      { status: 200 },
    );
  }
}
