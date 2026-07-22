import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/trainer/search — TRAINER page · "search" sub-tab (R12-B1).
// Reads the R9 trainer's config-space search state (bandit_posteriors +
// standing_hypotheses + compass_weights) via query_trainer_search.py (trainer.db,
// mode=ro). READ-ONLY display. Fail-soft: a Python error / empty store returns
// the empty shape (never a 500), so the sub-tab renders its <EmptyState>.
// Auth: middleware-enforced cookie session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Arm {
  arm_hash: string | null;
  level_id: number | null;
  axes: unknown;
  alpha: number | null;
  beta: number | null;
  n_obs: number | null;
  mean: number | null;
  last_sampled_at: string | null;
  updated_at: string | null;
}

interface Hypothesis {
  hypothesis_id: string | number | null;
  level_id: number | null;
  domain: string | null;
  claim: string | null;
  evidence: unknown;
  n_obs: number | null;
  status: string | null;
  last_updated: string | null;
}

interface Compass {
  level_id: number | null;
  w_consistency: number | null;
  w_magnitude: number | null;
  dd_ceiling: number | null;
  cvar_floor: number | null;
  learned: number | null;
  updated_at: string | null;
}

interface SearchResponse {
  status: "ok" | "no_data_yet";
  arms: Arm[];
  hypotheses: Hypothesis[];
  compass: Compass | null;
  counts: { arms: number; hypotheses: number };
  error?: string;
}

const FALLBACK: SearchResponse = {
  status: "no_data_yet",
  arms: [],
  hypotheses: [],
  compass: null,
  counts: { arms: 0, hypotheses: 0 },
};

export async function GET() {
  try {
    const raw = await runPython("query_trainer_search.py", [], { timeout: 15_000 });
    return NextResponse.json(safeJsonParse<SearchResponse>(raw, FALLBACK));
  } catch (err) {
    return NextResponse.json({ ...FALLBACK, error: String(err) }, { status: 200 });
  }
}
