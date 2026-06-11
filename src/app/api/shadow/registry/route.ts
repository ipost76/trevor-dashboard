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
  function: "Entry" | "Exit" | "Scoring" | "Risk" | "Data" | "Other";
  rows: number;
  rows_48h: number;
  latest_write: string | null;
  status: "ACTIVE" | "DORMANT" | "BROKEN";
  expected_active: boolean;
  retired: boolean;
  auto_derived: boolean;
  divergence_col: string | null;
  divergent_n: number | null;
  divergence_pct: number | null;
  promotion: "ready" | "accruing" | "na";
  promotion_n: number | null;
  error?: string;
}

interface ShadowRegistryResponse {
  tables: ShadowTable[];
  by_function: Record<string, string[]>;
  by_status: Record<string, number>;
  total: number;
  promotion_ready: number;
  stale_days: number;
  promotion_min_n: number;
  replica_age_seconds: number | null;
  replica_mtime: string | null;
  error?: string;
}

const FALLBACK: ShadowRegistryResponse = {
  tables: [],
  by_function: {},
  by_status: { ACTIVE: 0, DORMANT: 0, BROKEN: 0 },
  total: 0,
  promotion_ready: 0,
  stale_days: 7,
  promotion_min_n: 30,
  replica_age_seconds: null,
  replica_mtime: null,
};

export async function GET() {
  try {
    // Enumerates ~50 tables (COUNT + MAX + divergence per table) — give it headroom.
    const raw = await runPython("query_shadow_registry.py", [], { timeout: 15_000 });
    const data = safeJsonParse<ShadowRegistryResponse>(raw, FALLBACK);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { ...FALLBACK, error: String(err) },
      { status: 200 },
    );
  }
}
