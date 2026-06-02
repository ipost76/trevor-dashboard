import { NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";

export const dynamic = "force-dynamic";

// PERF-02 (2026-06-02): single-flight + SWR (15s) so a cold-cache burst spawns
// ONE Python child per window, not N. The try/catch around swr() preserves the
// cold-failure contract (500); a transient warm failure now serves stale instead.
const cache = createSwrCache<unknown>({ defaultTtl: 15_000, concurrency: 2 });

export async function GET() {
  try {
    const { value } = await cache.swr("circuit-breaker", async () => {
      const raw = await runPython("query_circuit_breaker.py", [], { timeout: 10_000 });
      return JSON.parse(raw);
    });
    return NextResponse.json(value);
  } catch (e) {
    return NextResponse.json(
      { overall_status: "UNKNOWN", error: String(e) },
      { status: 500 }
    );
  }
}
