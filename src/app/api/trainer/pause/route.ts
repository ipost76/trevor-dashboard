import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";
import { callGateway, gatewayResponse } from "@/lib/gateway-client";

// /api/trainer/pause — R12-B3 (H5), the trainer PAUSE control.
//
// GET  → the current pause state (query_trainer_pause.py, replica mode=ro). The
//        control renders only when `enabled` (HUB_PAUSE_CONTROL_ENABLED) is true.
// POST → RECORD a pause/resume REQUEST through the two-hop write gateway
//        (trainer.pause / trainer.resume → local :3939 → VM :3940 → gw_exec →
//        set_trainer_pause.py). The VM script writes ONLY the additive
//        trainer_pause_state row + the change_log audit — NO WATCHER_* flag,
//        NO champion/shadow_defs, NO level mint. THE WATCHER STAYS ON.
//
// 🚨 THIS RECORDS INTENT; IT DOES NOT STOP A RUNNING LOOP. trainer_loop.py checks
// TRAINER_LOOP_ENABLED once at entry — its while-body never re-reads it — so the
// daemon must POLL this durable state per-iteration (wired in R13). Until then the
// UI copy says exactly that; it NEVER renders "trainer paused" as an asserted
// daemon state.
//
// Gate: HUB_PAUSE_CONTROL_ENABLED (default OFF) — enforced AUTHORITATIVELY VM-side
// by gw_exec._flag_on (423 when off). callGateway ALWAYS resolves: 400
// unknown_op/validation · 401 auth · 423 locked · 500 gateway_token_missing ·
// 502/504 VM unreachable/timeout. Auth: middleware-enforced cookie session.
//
// 📋 RF3T2-B8 (NIT-4 "Hub dead-button / stripped-op cluster", DOCUMENT — mostly STALE).
// RECON-GIGANTIC-001 filed a 5-part cluster; re-verified live this run:
//   G3  "PAUSE TRADING silently 400s"  → ALREADY-CLOSED. Not dead: HUB_PAUSE_CONTROL_ENABLED
//       is `true` in live auto_config, this route is flag-gated with a documented 423, and
//       the UI is wired (trainer-pause-control.tsx). It records intent by design (above).
//   G9  ExitProfile.atr_adjustment dead field → ALREADY-CLOSED (0 hits repo-wide).
//   G10 circular lazy import → 0 hits.
//   G12 "~14 stripped write routes → 400 unknown_op" → COUNT STALE: only 4 callGateway
//       routes exist today.
//   G11 ENTRY_STOP_DISTANCE_SHADOW / EXTERNAL_CLOSE_OUTCOME_SHADOW firing by config-key
//       absence → 0 hits on WSL; these are VM-side. MIS-ROUTED to B8 — handed off
//       handoff-grade to the VM prompt that takes T2-i (see CLAUDE.md).
// Nothing here needs a code change; recorded so the cluster is not re-filed as "new".

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PauseState {
  enabled: boolean;
  paused: boolean;
  scope: string | null;
  requested_at: string | null;
  requested_by: string | null;
  reason: string | null;
  replica_age_seconds: number | null;
  replica_mtime: string | null;
  error?: string | null;
}

const FALLBACK: PauseState = {
  enabled: false,
  paused: false,
  scope: null,
  requested_at: null,
  requested_by: null,
  reason: null,
  replica_age_seconds: null,
  replica_mtime: null,
};

export async function GET() {
  try {
    const raw = await runPython("query_trainer_pause.py", [], { timeout: 15_000 });
    return NextResponse.json(safeJsonParse<PauseState>(raw, FALLBACK));
  } catch (err) {
    return NextResponse.json({ ...FALLBACK, error: String(err) }, { status: 200 });
  }
}

export async function POST(request: Request) {
  let body: { action?: unknown; reason?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const action = String(body.action ?? "").trim().toLowerCase();
  if (action !== "pause" && action !== "resume") {
    return NextResponse.json(
      { ok: false, error: "action must be 'pause' or 'resume'" },
      { status: 400 },
    );
  }

  // Build a CLEAN args object — ONLY `reason` may reach the envelope (ops.js
  // structurally rejects any other key, so no WATCHER_*/config field can slip in).
  const args: { reason?: string } = {};
  if (typeof body.reason === "string" && body.reason.trim()) {
    args.reason = body.reason.trim().slice(0, 2000);
  }

  const op = action === "pause" ? "trainer.pause" : "trainer.resume";
  const gw = await callGateway(op, args, {
    actor: "hub:ghost",
    reason: `trainer.${action}`,
  });
  return gatewayResponse(gw);
}
