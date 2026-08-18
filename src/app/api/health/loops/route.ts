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
const LOOPS_TTL_MS = 20_000;
const cache = createSwrCache<LoopsResponse>({ defaultTtl: LOOPS_TTL_MS, concurrency: 1 });

// 🚨 [B2] (2026-08-17) — THE TIGHT CEILING, AND WHY THIS ROUTE OF ALL ROUTES.
//
// 6× the TTL = 120s, the same multiplier as OPEN_SET_STALENESS_CEILING_MS in
// heartbeat-open-set.ts. Past it the cache refuses to serve stale and the `unknown()`
// contract below — which existed, was correct, and was structurally unreachable on a warm
// entry — finally becomes reachable.
//
// This route earns the tightest tier because its payload IS a freshness claim. It exists
// precisely because the ~21-min replica lag is too stale to answer "did a background loop
// stop" (B6's ruling: no replica fallback, because a labelled-stale card is still a card
// people read as current). A cache that serves this payload for two minutes past its TTL
// is re-introducing, one layer up, the exact staleness the route was built to escape.
//
// Measured here 2026-08-17 23:36Z BEFORE the fix: this key served a payload built 3h14m
// earlier (11,674,540ms) claiming `age_sec: 2107`, while the live VM row at that same
// instant read iteration_count 329 / last_iteration 22:47:09Z / true age 2968s. The
// payload said 326 / 19:46:54Z. Nothing errored.
const LOOPS_STALENESS_CEILING_MS = 6 * LOOPS_TTL_MS;

function unknown(reason: string): LoopsResponse {
  return {
    status: "unknown",
    source: "vm-live",
    degraded_column: null,
    loops: [],
    rollup: { worst: "unknown", counts: {}, active: 0, total: 0 },
    error: reason,
    // No payload was built, so there is no build stamp. NULL, never `Date.now()` — a
    // fresh-looking watermark on a failed read is the same lie in a new field.
    built_at_epoch_ms: null,
    served_at_epoch_ms: Date.now(),
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
    // 🚨 [B2] `ts` IS THE WATERMARK, AND THE CACHE HAS ALWAYS RETURNED IT. `swr()` resolves
    // `{ value, stale, ts }` — `ts` being the exact epoch-ms the served payload was stored.
    // 28 of this repo's 31 swr call sites destructured `{ value }` and threw the rest away,
    // this route included: the cache KNEW the payload was 3h old, SAID so on the wire, and
    // the route discarded the sentence. Carrying `ts` through as `built_at_epoch_ms` is what
    // lets the consumer re-derive the age instead of trusting a number frozen at build time.
    const { value, ts } = await cache.swr("health-loops", computeLoops, {
      stalenessCeiling: LOOPS_STALENESS_CEILING_MS,
    });
    return NextResponse.json({
      ...value,
      built_at_epoch_ms: ts,
      served_at_epoch_ms: Date.now(),
    });
  } catch (err) {
    // Never a 500: /health must render even when the pipe is down. Fail-open toward the
    // page, fail-loud toward the reader.
    return NextResponse.json(unknown(String(err).slice(0, 300)), { status: 200 });
  }
}
