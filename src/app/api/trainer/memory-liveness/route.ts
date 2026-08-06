import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/trainer/memory-liveness — TRAINER page · R11 liveness LINE (R12-B1 ·
// decision 7). Reads the WSL-local R11 store (entry count + tier H/W/C counts)
// via query_memory_liveness.py (memory.db, mode=ro). A LINE, not an alarm.
// Fail-soft → never a 500. Auth: middleware-enforced cookie session.
//
// 🚨 The fail-soft shape is `unavailable`, NOT a zero count. Falling back to
// `{ entries: 0 }` under a status the renderer could not distinguish is what made
// a failed read display as a confident `0`. The safety (no 500, no white screen)
// is unchanged; what the caller is TOLD about that safety is not.
//
// 🚨 RM-TRAINER-B4 — `memory_projection_enabled` is a SWITCH POSITION, not a count.
// Every table behind `entries`/`tiers` is written only when MEMORY_REASONING_ENABLED
// is on, so with the flag off those zeroes report the flag rather than the memory
// layer. The helper resolves it LIVE from os.environ using trainer_loop._truthy's exact
// expression — this route only carries the value through and MUST NOT default it.
// `source_rows` is the projection's two source tables (rejection_log +
// standing_hypotheses); **null means unreadable, which is not zero.**

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LivenessResponse {
  status: "ok" | "no_data_yet" | "unavailable";
  entries: number;
  tiers: { H: number; W: number; C: number };
  memory_projection_enabled?: boolean;
  source_rows?: number | null;
  error?: string;
}

// 🚨 The fallback deliberately OMITS `memory_projection_enabled`. A `false` here would
// be this route ASSERTING the flag is off on a path where the helper never ran and
// nothing was resolved — inventing the very fact the field exists to report. Absent
// means unknown, and the renderer treats only a strict `false` as off.
const FALLBACK: LivenessResponse = {
  status: "unavailable",
  entries: 0,
  tiers: { H: 0, W: 0, C: 0 },
  source_rows: null,
};

export async function GET() {
  try {
    const raw = await runPython("query_memory_liveness.py", [], { timeout: 15_000 });
    return NextResponse.json(safeJsonParse<LivenessResponse>(raw, FALLBACK));
  } catch (err) {
    return NextResponse.json({ ...FALLBACK, error: String(err) }, { status: 200 });
  }
}
