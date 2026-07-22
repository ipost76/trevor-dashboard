import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/watcher/critiques — WATCHER page backend (critique + errors sub-tabs).
//
// Backs the R12 WATCHER cockpit's `critique` and `errors` sub-tabs. Returns the
// R10 watcher's OWN store (data/watcher.db, mode=ro): the problems the watcher
// flagged (watcher_critiques), the real live detections (watcher_errors), and
// the per-check health roll-up (watcher_health).
//
// READ-ONLY. query_watcher_critiques.py opens the WSL-local watcher.db mode=ro,
// parses mechanical_json Python-side (never emits the raw blob or the R11 memory
// hook). Pre-cutover EMPTY is the display: 0 rows -> empty shape, never a 500.
//
// Auth: middleware-enforced cookie session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FiredCheck {
  check: string;
  evidence: string;
}
interface Critique {
  id: number;
  decision_ref: string;
  decision_kind: string;
  level_id: number;
  severity: "note" | "concern" | "problem" | string;
  fired_checks: FiredCheck[];
  checks_applicable: number;
  judgment_text: string | null;
  llm_used: boolean;
  ts: string;
}
interface WatcherError {
  id: number;
  source: string;
  summary: string;
  first_seen_ts: string;
  last_seen_ts: string;
  resolved: boolean;
}
interface WatcherHealth {
  check_name: string;
  status: string;
  detail: string | null;
  updated_at: string;
}
interface WatcherCritiquesResponse {
  status: string;
  critiques: Critique[];
  errors: WatcherError[];
  health: WatcherHealth[];
  updated_seconds: number | null;
  updated_at: string | null;
  error?: string;
}

const FALLBACK: WatcherCritiquesResponse = {
  status: "ok",
  critiques: [],
  errors: [],
  health: [],
  updated_seconds: null,
  updated_at: null,
};

export async function GET() {
  try {
    const raw = await runPython("query_watcher_critiques.py", [], { timeout: 8_000 });
    const data = safeJsonParse<WatcherCritiquesResponse>(raw, FALLBACK);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ ...FALLBACK, error: String(err) }, { status: 200 });
  }
}
