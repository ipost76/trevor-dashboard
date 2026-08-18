import { NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";

// /api/memory/health — Read-only system health snapshot.
// Calls query_system_health.py (self-probe collector). Always returns HTTP 200;
// degraded shape on error so the UI handles failure gracefully.

export const dynamic = "force-dynamic";

// INFRA-05 (2026-06-03): query_system_health.py is a FORK-HEAVY collector
// (~6-10 `systemctl is-active` / network subprocess spawns per call). Wrap it in
// single-flight + 10s SWR so repeated/concurrent hits don't fork-storm — a burst
// collapses to ONE collection. 10s is short for slowly-varying CPU/mem/disk/
// service-state; the included `killswitch_enabled` is ≤10s fresh (and not the
// live killswitch source — the UI reads /api/killswitch for that).
const MEMORY_HEALTH_TTL_MS = 10_000;
// 🚨 [B2] (2026-08-17): 6× TTL = 60s — the OPEN_SET_STALENESS_CEILING_MS multiplier applied
// to this route's own 10s TTL, which is the identical arithmetic (6 × 10_000) that produced
// that constant. It lands BELOW the 120s the other ssh-vm routes carry because its TTL is
// half theirs — the value is derived per-route, never copied across routes.
// Measured before the fix: served 11,731,113ms old (3h15m), snapshot_at 20:21:30Z; the
// refresh it triggered returned 23:37:02Z.
const MEMORY_HEALTH_STALENESS_CEILING_MS = 6 * MEMORY_HEALTH_TTL_MS;
const cache = createSwrCache<Record<string, unknown>>({
  defaultTtl: MEMORY_HEALTH_TTL_MS,
  concurrency: 2,
  stalenessCeiling: MEMORY_HEALTH_STALENESS_CEILING_MS,
});

async function computeHealth(): Promise<Record<string, unknown>> {
  const stdout = await runPython("query_system_health.py", []);
  return JSON.parse(stdout) as Record<string, unknown>;
}

export async function GET() {
  try {
    const { value } = await cache.swr("memory-health", computeHealth);
    return NextResponse.json(value);
  } catch (e) {
    return NextResponse.json(
      {
        snapshot_at: new Date().toISOString(),
        // 🚨 [B2] (2026-08-17) — WAS `false`. A read that FAILED cannot report the
        // killswitch as disengaged: that is a fabricated all-clear about a money-path
        // control, pixel-identical to a real reading of "safe". `null` is the honest
        // shape and it is already the ruling twice over in this repo —
        // /api/memory/autotrader-toggle and /api/auto/partials-toggle both carry
        // `killswitch_enabled: null` on their failure paths with a comment naming the
        // `false` version "a confident all-clear about a money-path". Same law as
        // QUAL-01's `{"active": null, "status": "unknown"}` on /api/system-health.
        //
        // The [B2] ceiling above is what makes this branch REACHABLE on a warm cache: it
        // used to be cold-start-only. Shipping the ceiling without this token would have
        // turned a stale-but-true reading into a fresh-looking fabricated one.
        killswitch_enabled: null,
        services: [],
        collectors: [],
        sentinels: [],
        source: "self-probe",
        stale_seconds: null,
        error: String(e),
      },
      { status: 200 },
    );
  }
}
