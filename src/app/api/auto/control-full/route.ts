import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/auto/control-full — D2 (Control Center) backend.
//
// Returns every boolean-valued row in auto_config, categorized per A1
// Section 3 (Execution · Signal Gates · Critic Stack · Calibration · Risk
// · Experimental · Misc) and tagged with a sensitivity_tier (1/2/3) per
// A1 Section 9.
//
// READ-ONLY. The PATCH counterpart lives at /api/auto/control-full/[key]
// and is gated by auto_config.LIVE_EDIT_ENABLED.
//
// Auth: middleware-enforced cookie session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ControlRow {
  key: string;
  value: "true" | "false";
  updated_at: string | null;
  category: string;
  sensitivity_tier: 1 | 2 | 3;
  immutable: boolean;
  immutable_reason: string | null;
}

interface ControlFullResponse {
  controls: ControlRow[];
  total: number;
  by_category: Record<string, number>;
  by_tier: Record<string, number>;
  live_edit_enabled: boolean;
  error?: string;
}

const FALLBACK: ControlFullResponse = {
  controls: [],
  total: 0,
  by_category: {},
  by_tier: {},
  live_edit_enabled: false,
};

export async function GET() {
  try {
    const raw = await runPython("query_control_full.py", [], { timeout: 8_000 });
    const data = safeJsonParse<ControlFullResponse>(raw, FALLBACK);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { ...FALLBACK, error: String(err) },
      { status: 200 },
    );
  }
}
