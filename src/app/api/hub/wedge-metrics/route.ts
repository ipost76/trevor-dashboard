import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Wedge-Rate metrics route [B2] — READ-ONLY. Serves the bot's loop-freeze
// regression signal (today's wedge count, 7-day trend, worst stall today, last
// boot) so the Hub tile can render it. The data is produced VM-side by the
// companion [B1] job as logs/wedge_metrics.json; this route reads that VM file
// over the read-only `ssh vm` pipe via query_wedge_metrics.py (runPython), the
// same VM-file-read mechanism the memory routes use (query_memory_daily.py). No
// Hub→VM write, no new ssh path/secret, no log parsing Hub-side.
//
// ~20s SWR cache so the tile's poll (and multiple viewers) never spawns one
// ssh-vm per request; single-flight collapses concurrent misses to a single
// remote read. A transient VM error is NOT cached — the compute throws so SWR
// keeps serving the last-good metrics (stale_minutes grows, surfacing the age
// honestly); a cold error / helper crash surfaces as {status:"error"}, never 500.
//
// Contract-faithful states:
//   file absent (B1 not deployed / mid-write absent) -> { status: "no_data" }
//   parse error / VM unreachable                     -> { status: "error", error }
//   success                                          -> { status: "ok", ...metrics, stale_minutes }

interface HelperResult {
  status?: string; // "ok" | "no_data" | "error"
  metrics?: Record<string, unknown>;
  error?: string;
}

const WEDGE_TTL_MS = 20_000;
// 🚨 [B2] (2026-08-17): 6× TTL = 120s — the OPEN_SET_STALENESS_CEILING_MS multiplier.
// This route reads a VM-only file over the ssh pipe and the tile above it computes
// `stale_minutes` from `generated_at`, so a stale-served payload produced a stale-minutes
// figure that was itself stale. Measured before the fix: served 11,731,132ms old (3h15m)
// with `generated_at 16:16:47-04:00`; the refresh it triggered returned 19:27:46-04:00.
const WEDGE_STALENESS_CEILING_MS = 6 * WEDGE_TTL_MS;
const cache = createSwrCache<HelperResult>({
  defaultTtl: WEDGE_TTL_MS,
  concurrency: 1,
  stalenessCeiling: WEDGE_STALENESS_CEILING_MS,
});

async function readWedgeMetrics(): Promise<HelperResult> {
  const stdout = await runPython("query_wedge_metrics.py", [], { timeout: 12_000 });
  const parsed = safeJsonParse<HelperResult>(stdout, { status: "error", error: "parse failure" });
  if (parsed.status === "error") {
    // Don't cache a transient VM/parse error — throw so SWR keeps serving the
    // last-good value (stale_minutes will grow and surface the staleness). A cold
    // error (no last-good) rejects and is caught in GET as {status:"error"}.
    throw new Error(parsed.error ?? "wedge metrics unavailable");
  }
  return parsed; // "ok" or "no_data"
}

function staleMinutes(generatedAt: unknown): number | null {
  if (typeof generatedAt !== "string") return null;
  const t = Date.parse(generatedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 60_000));
}

export async function GET() {
  let result: HelperResult;
  try {
    result = (await cache.swr("wedge-metrics", readWedgeMetrics)).value;
  } catch (e) {
    // Cold error (no last-good to serve) or a runPython throw — honest error
    // state, never a 500 (must never blank the dashboard).
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ status: "error", error: msg }, { status: 200 });
  }

  if (result.status === "no_data") {
    return NextResponse.json({ status: "no_data" }, { status: 200 });
  }
  if (result.status !== "ok" || !result.metrics) {
    return NextResponse.json(
      { status: "error", error: result.error ?? "wedge metrics unavailable" },
      { status: 200 },
    );
  }

  const metrics = result.metrics;
  return NextResponse.json(
    { status: "ok", ...metrics, stale_minutes: staleMinutes(metrics.generated_at) },
    { status: 200 },
  );
}
