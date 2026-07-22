import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/trainer/capability-queue — TRAINER page · "capability" sub-tab
// (R12-B1 · H8). Reads the R9 trainer's capability_requests (shadow_id +
// requested axes + reason + status) via query_capability_queue.py (replica,
// mode=ro). ABSENT until cutover → empty shape (never 500).
//
// 🚨 READ-ONLY — a CC prompt services the queue; the Hub NEVER writes here.
// Auth: middleware-enforced cookie session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// capability_requests is loop-owned + absent pre-cutover, so the reader SELECT *s
// and each request is a flexible column map (shadow_id/status stable).
type CapabilityRequest = Record<string, unknown> & {
  shadow_id: string | null;
  status: string | null;
};

interface CapabilityResponse {
  status: "ok" | "no_data_yet";
  requests: CapabilityRequest[];
  count: number;
  replica_age_seconds: number | null;
  replica_mtime: string | null;
  error?: string;
}

const FALLBACK: CapabilityResponse = {
  status: "no_data_yet",
  requests: [],
  count: 0,
  replica_age_seconds: null,
  replica_mtime: null,
};

export async function GET() {
  try {
    const raw = await runPython("query_capability_queue.py", [], { timeout: 15_000 });
    return NextResponse.json(safeJsonParse<CapabilityResponse>(raw, FALLBACK));
  } catch (err) {
    return NextResponse.json({ ...FALLBACK, error: String(err) }, { status: 200 });
  }
}
