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
  // STALE (B2): registered expected_active but silent beyond its own write cadence.
  status: "ACTIVE" | "DORMANT" | "BROKEN" | "STALE";
  expected_active: boolean;
  // B2 stale-when-expected telemetry (null unless expected_active + rows + ts).
  median_gap_sec?: number | null;
  max_gap_sec?: number | null;
  stale_threshold_sec?: number | null;
  silence_sec?: number | null;
  retired: boolean;
  auto_derived: boolean;
  divergence_col: string | null;
  divergent_n: number | null;
  divergence_pct: number | null;
  promotion: "ready" | "accruing" | "na";
  promotion_n: number | null;
  // HUB-C2 realized-outcome aggregates (read-only over existing realized_pnl_usd /
  // actual_pnl_usd columns). null when the table has no realized-outcome column
  // (Group C: count-only — must render "n/a — no per-trade outcome", never a WR).
  outcome_col: string | null;
  outcome_linked_n: number | null;
  outcome_mean_pnl: number | null;
  outcome_min_pnl: number | null;
  outcome_max_pnl: number | null;
  outcome_win_rate: number | null;
  // E1 $-impact ranking. outcome_sum_pnl = Σ realized $ over DISTINCT trades
  // (dedup per trade — NEVER the raw per-cycle Σ, which is a counting artifact).
  // footprint_n = distinct-trade count. confidence_tag = n-based band.
  // metric_type classifies the table: "flip_delta" (logs a true would-vs-actual
  // counterfactual — stronger evidence class) vs "footprint" (ranked by realized
  // footprint, NOT proven "$ if flipped"); null when no realized-outcome column.
  // outcome_sum_pnl / footprint_n / confidence_tag are null until a footprint exists.
  outcome_sum_pnl: number | null;
  footprint_n: number | null;
  confidence_tag: "HIGH" | "MED" | "LOW" | "WEAK" | null;
  metric_type: "flip_delta" | "footprint" | null;
  error?: string;
}

// B6 unified shadow registry (additive). One object per row in `shadow_registry`,
// folded with observation aggregates from the single `shadow_observations` table.
// Consumed by the Health <ShadowLabCard>; the Intel shadow-overview ignores it.
// Empty ([]) until B7 registers the first shadow (ssl.py).
interface RegisteredShadow {
  shadow_key: string;
  display: string;
  category: string;
  candidate_desc: string | null;
  obs_table: string;
  shadow_flag: string | null;
  promote_flag: string | null;
  min_n: number;
  registry_status: string | null;
  expected_active: boolean;
  created_at: string | null;
  promoted_at: string | null;
  notes: string | null;
  verdict: Record<string, unknown> | null;
  obs_total: number;
  obs_48h: number;
  latest_obs: string | null;
  divergent_n: number;
  divergence_pct: number | null;
  promotion: "ready" | "accruing" | "na";
  promotion_n: number;
  outcome_linked_n: number;
  outcome_mean_pnl: number | null;
  outcome_min_pnl: number | null;
  outcome_max_pnl: number | null;
  outcome_win_rate: number | null;
  status: "ACTIVE" | "DORMANT";
  error?: string;
}

interface ShadowRegistryResponse {
  tables: ShadowTable[];
  by_function: Record<string, string[]>;
  by_status: Record<string, number>;
  total: number;
  promotion_ready: number;
  stale_count?: number;
  stale_days: number;
  promotion_min_n: number;
  registered_shadows: RegisteredShadow[];
  replica_age_seconds: number | null;
  replica_mtime: string | null;
  error?: string;
}

const FALLBACK: ShadowRegistryResponse = {
  tables: [],
  by_function: {},
  by_status: { ACTIVE: 0, DORMANT: 0, BROKEN: 0, STALE: 0 },
  total: 0,
  promotion_ready: 0,
  stale_count: 0,
  stale_days: 7,
  promotion_min_n: 30,
  registered_shadows: [],
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
