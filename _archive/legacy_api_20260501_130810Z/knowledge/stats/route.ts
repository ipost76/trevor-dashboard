import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SIDECAR_URL = "http://127.0.0.1:5100";

// Cache KB stats for 5 minutes
let _kbStatsCache: { data: unknown; ts: number } | null = null;
const KB_STATS_CACHE_TTL = 300_000;

export async function GET() {
  if (_kbStatsCache && Date.now() - _kbStatsCache.ts < KB_STATS_CACHE_TTL) {
    return NextResponse.json(_kbStatsCache.data, {
      headers: { "X-Cache": "HIT", "Cache-Control": "private, max-age=300" },
    });
  }

  try {
    const sidecarRes = await fetch(`${SIDECAR_URL}/collections`, {
      signal: AbortSignal.timeout(15000),
    });

    if (!sidecarRes.ok) {
      return NextResponse.json(
        { total_entries: 0, error: `Sidecar error: ${sidecarRes.status}` },
        { status: 502 }
      );
    }

    const raw = await sidecarRes.json();
    const collections = raw.collections || {};

    // Transform to match expected response format
    const data = {
      collections: Object.entries(collections).map(([name, count]) => ({ name, count })),
      total_entries: Object.values(collections).reduce((sum: number, c) => sum + (c as number), 0),
    };

    _kbStatsCache = { data, ts: Date.now() };
    return NextResponse.json(data, {
      headers: { "X-Cache": "MISS", "Cache-Control": "private, max-age=300" },
    });
  } catch (err) {
    return NextResponse.json(
      { total_entries: 0, error: `Embedding sidecar unavailable: ${String(err)}` },
      { status: 503 }
    );
  }
}
