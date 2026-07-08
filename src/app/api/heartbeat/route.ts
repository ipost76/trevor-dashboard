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
    // RM-DECOM B5 (2026-07-08): the Observatory is being decommissioned (B3 tears
    // down monitor-center + the :8443 heartbeat). A dead upstream used to surface
    // as 502/503, which rendered a red "Observatory unreachable" ERROR card. Now
    // the failure path returns a 200 with a `retired` empty shape (NO
    // `overall_status`/`categories`) so consumers can render a calm neutral state
    // instead of an error. The success path above is UNCHANGED — while the
    // Observatory is still alive it proxies real heartbeat data; only a genuine
    // outage falls here. Consumers discriminate the retired shape by the ABSENCE
    // of `overall_status` (a real heartbeat always carries it):
    //   • heartbeat-view.tsx  → neutral "heartbeat retired" card (not the warn one)
    //   • health-rollup.tsx    → hbAvailable=false → UNKNOWN (never a false green)
    //   • reconcile-health-card → categories absent → its existing "pending" state
    const reason =
      error instanceof ObservatoryStatusError
        ? error.message
        : `Observatory unreachable: ${String(error)}`;
    return NextResponse.json({ observatory: "retired", reason }, { status: 200 });
  }
}

// [B3] Hub read-only lockdown (2026-06-28): the POST write-action (poked the
// Observatory /api/heartbeat/refresh URL) was removed. Only the GET read-proxy
// remains — the 30s GET poll covers refresh; the path 405s on a write verb.
