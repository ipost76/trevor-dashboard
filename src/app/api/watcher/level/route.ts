import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/watcher/level — WATCHER page backend (level-tracking sub-tab, H6).
//
// Backs the R12 WATCHER cockpit's `level` sub-tab. The minted level lives ONLY
// on the VM; query_level_state.py reads it PURE-SSH over the read-only `ssh vm`
// pipe (level_query.py current / money-path-at / integrity / config-tested-at)
// and NEVER touches a WSL table — so a lagging MAX(level_id) proxy is
// structurally unreachable.
//
// HARD UNKNOWN: on ANY level-read failure the Python returns
// {status:"unknown", reason:...} (never a guessed level). The route never 500s
// (safeJsonParse + fallback); the component renders "unknown" as
// "level: unknown (pipe unavailable)".
//
// Timeout is generous (30s) because the reader makes several ssh round-trips;
// query_level_state.py itself fails fast on `current` so a dead pipe returns
// quickly.
//
// Auth: middleware-enforced cookie session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LevelHistoryRow {
  level: number;
  created_at: string | null;
  money_path_change: string | null;
  prompt_id: string | null;
  commit_hash: string | null;
  is_revert: boolean;
  notes: string | null;
}
interface IntegrityCheck {
  check: string;
  ok: boolean;
  findings: unknown[];
}
interface LevelIntegrity {
  status: string;
  ok?: boolean;
  checks?: IntegrityCheck[];
  vacuous?: boolean;
  reason?: string | null;
}
interface LevelConfigTested {
  status: string;
  populated?: boolean;
  r8_dependency?: string | null;
  tested_at_levels?: number[];
  reason?: string | null;
}
interface LevelStateResponse {
  status: "ok" | "unknown" | string;
  reason?: string;
  current_level?: number;
  history?: LevelHistoryRow[];
  history_status?: string;
  integrity?: LevelIntegrity;
  config_tested?: LevelConfigTested;
  error?: string;
}

// Fail-safe fallback = a hard UNKNOWN (never a guessed level).
const FALLBACK: LevelStateResponse = {
  status: "unknown",
  reason: "level reader unavailable",
};

export async function GET() {
  try {
    const raw = await runPython("query_level_state.py", [], { timeout: 30_000 });
    const data = safeJsonParse<LevelStateResponse>(raw, FALLBACK);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ ...FALLBACK, error: String(err) }, { status: 200 });
  }
}
