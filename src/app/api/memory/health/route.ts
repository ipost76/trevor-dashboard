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
const cache = createSwrCache<Record<string, unknown>>({ defaultTtl: 10_000, concurrency: 2 });

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
        killswitch_enabled: false,
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
