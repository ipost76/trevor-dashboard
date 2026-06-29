import { NextResponse } from "next/server";
import { createSwrCache } from "@/lib/single-flight";

// HB-04: thin proxy to the Observatory aiohttp server. Keeps the Hub's "all data
// flows through /api/*" convention while the actual collector + classifier + cache
// live in trevor-observatory.service.
// RR2 C-8 (2026-06-27): corrected the stale "127.0.0.1:3335" reference — the
// Observatory was moved off :3335 to the tailnet :8443 endpoint (W-E-P2b) and then
// onto the new box trevor-prime-2 (OBS-REPOINT). The live target is OBSERVATORY_URL.
const OBSERVATORY_URL = "https://trevor-prime-2.tail2bf7a3.ts.net:8443/api/heartbeat";

export const dynamic = "force-dynamic";

// RM-DASH 2026-05-29: a 5s read-through cache + single-flight on GET so a burst of
// /memory?tab=health polls (N tabs/devices on the aligned tick) collapses to ONE
// Observatory proxy call per window. `staleWhileRevalidate:false` (await-on-expiry)
// keeps the live-or-error semantics: each poll-tick still gets fresh data and a
// genuine Observatory outage still surfaces as 502/503 — only same-tick concurrent
// requests dedupe. POST (manual refresh trigger) is intentionally NOT cached.
const heartbeatCache = createSwrCache<unknown>({ defaultTtl: 5_000, concurrency: 2 });

// Upstream non-2xx → 502 (carries the upstream status, matching the prior body);
// a thrown fetch (timeout / connection refused) → 503.
class ObservatoryStatusError extends Error {
  constructor(public readonly upstream: number) {
    super(`Observatory returned ${upstream}`);
    this.name = "ObservatoryStatusError";
  }
}

export async function GET() {
  try {
    const { value } = await heartbeatCache.swr(
      "heartbeat",
      async () => {
        const res = await fetch(OBSERVATORY_URL, {
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new ObservatoryStatusError(res.status);
        return await res.json();
      },
      { staleWhileRevalidate: false },
    );
    return NextResponse.json(value);
  } catch (error) {
    if (error instanceof ObservatoryStatusError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: "Observatory unreachable", details: String(error) },
      { status: 503 },
    );
  }
}

// [B3] Hub read-only lockdown (2026-06-28): the POST write-action (poked the
// Observatory /api/heartbeat/refresh URL) was removed. Only the GET read-proxy
// remains — the 30s GET poll covers refresh; the path 405s on a write verb.
