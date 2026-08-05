// GET /api/math/values — read-only live values for the /math page.  [B2-MATH-API]
//
// Supplies the three things the page needs to teach how TREVOR decides without
// lying about it:
//   1. the standing `auto_config` values that make each formula concrete,
//   2. a mirror of the VM-only Python constants, stamped with its provenance and
//      drift-checked against the live rows wherever a live row exists,
//   3. an honest status/unavailable register, so a value that cannot be known
//      renders as a specific sentence rather than as a zero or a blank.
//
// READ-ONLY. SELECT only, against the litestream replica. No writes of any kind,
// no gateway calls, and — deliberately — no call to risk_breakers.evaluate_breakers(),
// which WRITES auto_config and can POST A REAL DISCORD ALERT; the stored
// RISK_BREAKERS_STATE_JSON row is read instead.
//
// 🚨 NO CACHE LAYER, ON PURPOSE. The replica's own ~20 min tailsync lag is the
// honest floor for "live"; an SWR wrapper on top of it (as several other Hub
// routes use) would serve a stale snapshot from a page whose entire claim is that
// these are the current values. `dynamic = "force-dynamic"` keeps every request a
// fresh read, and `replica.lagSeconds` tells the page exactly how old the data is
// so it can label itself.

import { NextResponse } from "next/server";
import { buildMathValues } from "@/lib/math-values";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const payload = buildMathValues();
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    // buildMathValues() is written to fail soft, so reaching here means something
    // genuinely unexpected. Still HTTP 200 with a structured body — matching the
    // Hub's convention — so the page renders "live values unavailable" instead of
    // breaking, and never mistakes an error for a set of zeroes.
    return NextResponse.json(
      {
        ok: false,
        replica: { path: "", lagSeconds: null, asOfUtc: "", stale: true },
        config: {},
        constants: {},
        aggregates: {},
        status: {
          paperGated: false,
          sleeveStatus: { inert: false, level: null, levelSource: "unavailable", proofs: [] },
          portfolioChain: [],
          gates: [],
          armedBreakers: [],
        },
        unavailable: [],
        errors: [`math values endpoint failed: ${String(err)}`],
        generatedAt: new Date().toISOString(),
        values: {},
        // 🚨 Populated, never omitted — B1's `if (!data || data.error)` guard is
        // decorative if a failed payload leaves this key out.
        error: `math values endpoint failed: ${String(err)}`,
        warnings: [`math values endpoint failed: ${String(err)}`],
      },
      { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
