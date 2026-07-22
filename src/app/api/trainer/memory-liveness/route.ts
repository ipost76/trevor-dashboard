import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/trainer/memory-liveness — TRAINER page · R11 liveness LINE (R12-B1 ·
// decision 7). Reads the WSL-local R11 store (entry count + tier H/W/C counts)
// via query_memory_liveness.py (memory.db, mode=ro). A LINE, not an alarm.
// Fail-soft → { entries: 0, tiers: {H:0,W:0,C:0} }, never a 500.
// Auth: middleware-enforced cookie session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LivenessResponse {
  status: "ok" | "no_data_yet";
  entries: number;
  tiers: { H: number; W: number; C: number };
  error?: string;
}

const FALLBACK: LivenessResponse = {
  status: "no_data_yet",
  entries: 0,
  tiers: { H: 0, W: 0, C: 0 },
};

export async function GET() {
  try {
    const raw = await runPython("query_memory_liveness.py", [], { timeout: 15_000 });
    return NextResponse.json(safeJsonParse<LivenessResponse>(raw, FALLBACK));
  } catch (err) {
    return NextResponse.json({ ...FALLBACK, error: String(err) }, { status: 200 });
  }
}
