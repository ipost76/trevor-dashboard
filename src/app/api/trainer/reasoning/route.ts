import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/trainer/reasoning — TRAINER page · "reasoning" sub-tab (R12-B1).
// Reads the R9 trainer's rejection_log (the "why it was rejected" narrative:
// failing gates + rationale + p_value + dsr) via query_trainer_reasoning.py
// (trainer.db, mode=ro). READ-ONLY display. Fail-soft → empty shape, never 500.
// Auth: middleware-enforced cookie session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Rejection {
  id: number | null;
  arm_hash: string | null;
  level_id: number | null;
  config: unknown;
  failing_gates: unknown;
  rationale: string | null;
  p_value: number | null;
  dsr: number | null;
  ts: string | null;
}

interface ReasoningResponse {
  status: "ok" | "no_data_yet";
  rejections: Rejection[];
  count: number;
  error?: string;
}

const FALLBACK: ReasoningResponse = {
  status: "no_data_yet",
  rejections: [],
  count: 0,
};

export async function GET() {
  try {
    const raw = await runPython("query_trainer_reasoning.py", [], { timeout: 15_000 });
    return NextResponse.json(safeJsonParse<ReasoningResponse>(raw, FALLBACK));
  } catch (err) {
    return NextResponse.json({ ...FALLBACK, error: String(err) }, { status: 200 });
  }
}
