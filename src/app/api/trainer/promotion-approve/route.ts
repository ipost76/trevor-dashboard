import { NextResponse } from "next/server";
import { callGateway, gatewayResponse } from "@/lib/gateway-client";

// POST /api/trainer/promotion-approve — H4, the ONE place the Hub can affect the
// live system, with its blast radius deliberately collapsed (R12-B1).
//
// 🚨 THE HUB RECORDS; IT NEVER APPLIES. This routes a RECORD-ONLY approval
// through the two-hop write gateway (promotion.approve → local :3939 → VM :3940
// → gw_exec → set_promotion_approval.py). The VM script writes exactly ONE row
// to promotion_approvals (applied=0) and touches NOTHING else. CC reads that
// record, applies the config, and mints the level later — Ghost approves, CC
// applies.
//
// Gate: HUB_PROMOTION_WRITE_ENABLED (default OFF) — enforced AUTHORITATIVELY
// VM-side by gw_exec._flag_on → 423 when off (the Hub gateway does NOT read the
// flag; the ops.js `flag` field is reference + the UI renders read-only). With
// the flag off, callGateway resolves to a 423 and this route passes it through.
//
// callGateway ALWAYS resolves (never throws): 400 unknown_op/validation · 401
// auth · 423 locked · 500 gateway_token_missing · 502/504 VM unreachable/timeout.
// gatewayResponse passes the status through so the UI can branch on res.status.
// Auth: middleware-enforced cookie session (a write route, POST-only).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { candidate_id?: unknown; decision?: unknown; note?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const candidate_id = String(body.candidate_id ?? "").trim();
  const decision = String(body.decision ?? "").trim().toLowerCase();
  if (!candidate_id) {
    return NextResponse.json({ ok: false, error: "candidate_id required" }, { status: 400 });
  }
  if (decision !== "approve" && decision !== "reject") {
    return NextResponse.json(
      { ok: false, error: "decision must be 'approve' or 'reject'" },
      { status: 400 },
    );
  }

  // Build a CLEAN args object — ONLY the three allowed keys ever reach the
  // envelope. Any extra field in the request body is dropped here (a second
  // layer beneath ops.js's structural extra-key rejection). `note` is included
  // only when a non-empty string is supplied.
  const args: { candidate_id: string; decision: string; note?: string } = {
    candidate_id,
    decision,
  };
  if (typeof body.note === "string" && body.note.trim()) {
    args.note = body.note.trim().slice(0, 2000);
  }

  const gw = await callGateway("promotion.approve", args, {
    actor: "hub:ghost",
    reason: `promotion.${decision}`,
  });
  return gatewayResponse(gw);
}
