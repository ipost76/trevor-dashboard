import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";
import type { LoopsResponse } from "@/components/memory/loop-heartbeat-format";

// GET /api/health/loops — [B6] / RM-WATCH. Background-loop heartbeat health.
//
// Backs <LoopHeartbeatCard/> on /health and its compact trainer variant on the TRAINER
// page. query_loop_heartbeat.py reads the LIVE VM trevor.db over the read-only `ssh` pipe
// (mode=ro) and classifies each loop into six states.
//
// 🚨 WHY LIVE AND NOT THE REPLICA. The WSL litestream replica runs ~19–30 min behind, so
// every loop with a cadence under ~12 min reads permanently stale off it. Measured B6: the
// Hub's pre-existing loop_heartbeat tile (query_system_health.collect_scanner_lag, replica-
// backed) returned red/"1596s" for scalp_scan_loop while the LIVE row was 2s old. Ghost's
// call at the B6 gate: NO replica fallback, because a labelled-stale card is still a card
// people read as current. A failed read renders UNKNOWN.
//
// 🚨 THE FAIL-SOFT SHAPE IS `unknown`, NOT AN EMPTY SUCCESS. `{loops: []}` under
// `status:"ok"` would render as "all clear" on a page whose entire job is saying when
// things are not clear. Every fallback below carries `status:"unknown"` and a reason.
// Mirrors /api/watcher/level's HARD UNKNOWN contract.
//
// GET-only, read-only, zero writes. It sits under /api/health/* like health/digests;
// middleware.ts allowlists the liveness probe by EXACT match on `/api/health`, so this
// stays auth-gated.
//
// Auth: middleware-enforced cookie session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The helper makes one ssh round-trip (~1–2s). Single-flight + a 20s SWR so a page with
// two mounts of this card — /health and the TRAINER line — collapses to ONE ssh call, and
// a burst of polls cannot fan out into a pile of concurrent ssh sessions.
const cache = createSwrCache<LoopsResponse>({ defaultTtl: 20_000, concurrency: 1 });

function unknown(reason: string): LoopsResponse {
  return {
    status: "unknown",
    source: "vm-live",
    degraded_column: null,
    loops: [],
    rollup: { worst: "unknown", counts: {}, active: 0, total: 0 },
    error: reason,
  };
}

async function computeLoops(): Promise<LoopsResponse> {
  // 25s: comfortably past the helper's own 20s ssh timeout, so a hung pipe is reported by
  // the helper (with its reason) rather than truncated into a bare route-level throw.
  const raw = await runPython("query_loop_heartbeat.py", [], { timeout: 25_000 });
  return safeJsonParse<LoopsResponse>(raw, unknown("the loop reader returned no usable JSON"));
}

export async function GET() {
  try {
    const { value } = await cache.swr("health-loops", computeLoops);
    return NextResponse.json(value);
  } catch (err) {
    // Never a 500: /health must render even when the pipe is down. Fail-open toward the
    // page, fail-loud toward the reader.
    return NextResponse.json(unknown(String(err).slice(0, 300)), { status: 200 });
  }
}
