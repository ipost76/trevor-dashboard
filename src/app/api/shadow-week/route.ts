import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/shadow-week — RM-CUTOVER Wave C · C4 Phase 2.
//
// The dual-instance shadow-week card. Route contract taken VERBATIM from B4's
// var/handoff/C4_HUB_PANEL_SPEC.md §3.
//
// 🚨 ADDITIVE. This is a NEW read of a NEW table (shadow_week_status in the Hub's
//    own data/hub.db). It changes NO existing route's data source. The Hub keeps
//    reading the VM exactly as it did before — the second instance is a second
//    read, never a replacement. The repoint is Wave D's and is not fired here.
//
// 🚨 NO VERDICT IS DERIVED ANYWHERE ON THIS PATH. B1 owns the classification and
//    B4 owns the vocabulary; this route and its card copy both verbatim. The only
//    computed field is `stale`, which is about the PANEL's freshness, not about
//    the two instances.
//
// 🚨 `stale` MUST RENDER AS A FAULT, NOT AS AN EMPTY CARD (spec §3). A panel that
//    silently shows its last known values when B4 has stopped writing reproduces
//    exactly the failure this monitoring exists to prevent: a stopped monitor and
//    a clean week look identical.
//
// Session-gated by middleware.ts like every other data route.
// ─────────────────────────────────────────────────────────────────────────────

export interface ShadowWeekRow {
  generated_at_et: string;
  tz_asserted: string;
  day: string;
  clean_days: number;
  target_days: number;
  day_state: string; // CLEAN | HOLD | RESET — B4's strings, verbatim
  day_cause: string | null;
  harness_state: string; // RUNNING | NOT-STARTED | STOPPED — verbatim
  last_heartbeat_age_s: number | null;
  drift_count: number;
  not_drift: Record<string, number>; // BLINDNESS/RESOURCE/UNCOMPARABLE/... verbatim
  pass_conditions: { id: string; status: string; last_fail_day: string | null }[];
  age_s: number | null;
}

export interface ShadowWeekResponse {
  panel_state: "OK" | "NO_DATA" | "UNREACHABLE" | "STALE";
  reason: string;
  stale: boolean;
  row: ShadowWeekRow | null;
  fetch: {
    fetched_at_utc: string;
    ok: number;
    source: string;
    error: string | null;
  } | null;
  schema: string;
}

// 🚨 The fallback is NO_DATA, never a clean card. If the helper cannot be run at
//    all we know strictly less than nothing about the shadow — and "no data" is a
//    state the card renders in its own right (spec §4 rule 3, and the reason
//    B4's digest reports NOT-STARTED rather than a clean day).
const FALLBACK: ShadowWeekResponse = {
  panel_state: "NO_DATA",
  reason: "helper_unavailable",
  stale: false,
  row: null,
  fetch: null,
  schema: "b4mon/hub-panel/1",
};

export async function GET() {
  try {
    const out = await runPython("scripts/db/query_shadow_week.py", [], {
      timeout: 8000,
    });
    const parsed = safeJsonParse<ShadowWeekResponse>(out, {
      ...FALLBACK,
      reason: "helper_returned_unparseable_output",
    });
    if (!parsed || typeof parsed.panel_state !== "string") {
      return NextResponse.json(
        { ...FALLBACK, reason: "helper_returned_unparseable_output" },
        { status: 200 }
      );
    }
    return NextResponse.json(parsed, { status: 200 });
  } catch (err) {
    // Fail-soft: never 500 the page. But fail-soft is NOT fail-green — the card
    // renders NO_DATA with the reason attached.
    return NextResponse.json(
      { ...FALLBACK, reason: `helper_error: ${String(err).slice(0, 200)}` },
      { status: 200 }
    );
  }
}
