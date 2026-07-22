import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/watcher/integrity — WATCHER page backend (integrity sub-tab).
//
// Backs the R12 WATCHER cockpit's `integrity` sub-tab. Returns the watcher's
// SEPARATE must-never-drift store (data/watcher_integrity.db, mode=ro): recorded
// integrity_findings, the declared-vs-detected reconciliation_log (ranked
// DANGEROUS-FIRST — undeclared_trading_change above declared_not_detected, then
// newest), and the integrity module's watcher_state.
//
// READ-ONLY. Pre-cutover EMPTY is the display: 0 rows -> empty shape, never 500.
//
// Auth: middleware-enforced cookie session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface IntegrityFinding {
  id: number;
  check_name: string;
  ok: boolean;
  vacuous: boolean;
  findings_count: number;
  findings: string[];
  level_id: number | null;
  ts: string;
}
interface ReconciliationRow {
  id: number;
  prompt_id: string | null;
  outcome: string;
  kind: string | null;
  kind_rank: number;
  triggers: string[];
  resolved: boolean;
  ts: string;
}
interface WatcherStateRow {
  key: string;
  value: string | null;
  updated_at: string;
}
interface WatcherIntegrityResponse {
  status: string;
  findings: IntegrityFinding[];
  reconciliation: ReconciliationRow[];
  state: WatcherStateRow[];
  updated_seconds: number | null;
  updated_at: string | null;
  error?: string;
}

const FALLBACK: WatcherIntegrityResponse = {
  status: "ok",
  findings: [],
  reconciliation: [],
  state: [],
  updated_seconds: null,
  updated_at: null,
};

export async function GET() {
  try {
    const raw = await runPython("query_watcher_integrity.py", [], { timeout: 8_000 });
    const data = safeJsonParse<WatcherIntegrityResponse>(raw, FALLBACK);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ ...FALLBACK, error: String(err) }, { status: 200 });
  }
}
