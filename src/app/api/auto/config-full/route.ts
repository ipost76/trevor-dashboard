import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/auto/config-full — D1 (Config editor) backend.
//
// Returns the full auto_config snapshot for non-boolean keys (booleans go
// through /api/auto/control-full instead). Each row is tagged with a
// category (A1 Section 2: Capital · Signal · Exit · Risk · Per-Ticker
// · Calibration · Execution · Misc) and an immutable flag.
//
// READ-ONLY. The PATCH counterpart lives at /api/auto/config-full/[key]
// and is gated by auto_config.LIVE_EDIT_ENABLED.
//
// Auth: middleware-enforced cookie session on all /api/* (no per-route check).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ConfigRow {
  key: string;
  value: string | null;
  updated_at: string | null;
  category: string;
  type: "int" | "float" | "json" | "str" | "bool";
  immutable: boolean;
  immutable_reason: string | null;
}

interface ConfigFullResponse {
  configs: ConfigRow[];
  total: number;
  by_category: Record<string, number>;
  live_edit_enabled: boolean;
  error?: string;
}

const FALLBACK: ConfigFullResponse = {
  configs: [],
  total: 0,
  by_category: {},
  live_edit_enabled: false,
};

export async function GET() {
  try {
    const raw = runPython("query_config_full.py", [], { timeout: 8_000 });
    const data = safeJsonParse<ConfigFullResponse>(raw, FALLBACK);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { ...FALLBACK, error: String(err) },
      { status: 200 },
    );
  }
}
