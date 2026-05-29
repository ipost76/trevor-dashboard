import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/shadow/registry — D4 (Shadow page) backend.
//
// Returns the full shadow-table inventory grouped by function (Entry /
// Exit / Scoring / Risk / Data) with per-table status (ACTIVE / DORMANT
// / BROKEN). Same classifier rules as query_shadow_status.py uses for
// the Intel-tab grid (rows==0 + expected_active → BROKEN; rows==0 +
// !expected_active → DORMANT; latest_write < 7d → ACTIVE; else DORMANT).
//
// READ-ONLY. The Intel-tab grid at /api/intel/shadow remains the deep-
// dive surface (with per-table key_stat dicts); this endpoint is the
// lighter, function-grouped roll-up for D4.
//
// Auth: middleware-enforced cookie session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ShadowTable {
  table_name: string;
  display: string;
  function: "Entry" | "Exit" | "Scoring" | "Risk" | "Data";
  rows: number;
  rows_48h: number;
  latest_write: string | null;
  status: "ACTIVE" | "DORMANT" | "BROKEN";
  expected_active: boolean;
  error?: string;
}

interface ShadowRegistryResponse {
  tables: ShadowTable[];
  by_function: Record<string, string[]>;
  by_status: Record<string, number>;
  total: number;
  stale_days: number;
  error?: string;
}

const FALLBACK: ShadowRegistryResponse = {
  tables: [],
  by_function: {},
  by_status: { ACTIVE: 0, DORMANT: 0, BROKEN: 0 },
  total: 0,
  stale_days: 7,
};

export async function GET() {
  try {
    const raw = await runPython("query_shadow_registry.py", [], { timeout: 10_000 });
    const data = safeJsonParse<ShadowRegistryResponse>(raw, FALLBACK);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { ...FALLBACK, error: String(err) },
      { status: 200 },
    );
  }
}
