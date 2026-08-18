import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ChromaDB PersistentClient cold-start ~38s; warm <1s. Cache list responses
// server-side so the first user pays once and subsequent loads are instant.
// PERF-02 (2026-06-02): single-flight + SWR (5min) on the `list` mode so a
// concurrent burst during the ~38s cold-start collapses to ONE Python child
// instead of N. peek/search modes stay uncached passthrough. X-Cache HIT/MISS
// preserved via peek (HIT = served from a stored value, MISS = freshly computed).
const CHROMA_LIST_TTL_MS = 5 * 60_000;
// 🚨 [B2] (2026-08-17) — THE ONE ROUTE RAISED ABOVE THE 2-MINUTE TIER, AND THE REASON IS A
// RULE, NOT AN EXCEPTION. Its TTL is 5 minutes, so the 120s the other four ssh-vm routes
// carry would sit BELOW the TTL — a ceiling under the TTL can only ever be crossed by an
// already-expired entry, which silently turns this route into `staleWhileRevalidate:false`
// and disables SWR entirely, inside what is meant to be a hardening option. NO CEILING MAY
// BE BELOW ITS ROUTE'S TTL; the floor is 2× TTL. 15 min = 3× TTL clears both bounds and is
// still half the 30-min default. It is also the right tier on merit: this payload is a
// ChromaDB collection listing, not a freshness claim — a 15-minute-old document count
// misleads nobody, where a 15-minute-old loop heartbeat does.
// Measured before the fix: served 71,315,764ms old (19h48m).
const CHROMA_LIST_STALENESS_CEILING_MS = 3 * CHROMA_LIST_TTL_MS;
const listCache = createSwrCache<unknown>({
  defaultTtl: CHROMA_LIST_TTL_MS,
  concurrency: 2,
  stalenessCeiling: CHROMA_LIST_STALENESS_CEILING_MS,
});

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "list";
  const collection = (url.searchParams.get("collection") ?? "").slice(0, 100);
  const q = (url.searchParams.get("q") ?? "").slice(0, 200);
  const limit = String(Math.max(1, Math.min(25, Number(url.searchParams.get("limit") ?? 10))));

  if (!["list", "peek", "search"].includes(mode)) {
    return NextResponse.json({ error: "invalid mode" }, { status: 400 });
  }
  if (mode !== "list") {
    if (!collection) return NextResponse.json({ error: "collection required" }, { status: 400 });
    if (!/^[a-zA-Z0-9_\-]+$/.test(collection)) {
      return NextResponse.json({ error: "invalid collection name" }, { status: 400 });
    }
  }

  // list mode — single-flight + SWR (5min) so cold-start bursts collapse to one.
  if (mode === "list") {
    const servedFromCache = listCache.peek("list") !== undefined;
    try {
      const { value } = await listCache.swr("list", async () => {
        const stdout = await runPython("query_chroma_browse.py", ["list"], { timeout: 60000 });
        return safeJsonParse(stdout, { mode, error: "parse failure" });
      });
      return NextResponse.json(value, { headers: { "X-Cache": servedFromCache ? "HIT" : "MISS" } });
    } catch (err) {
      return NextResponse.json({ mode, error: String(err) }, { status: 200 });
    }
  }

  // peek / search — uncached passthrough (unchanged).
  const args: string[] =
    mode === "peek" ? ["peek", collection, limit] : ["search", collection, q, limit];

  try {
    const stdout = await runPython("query_chroma_browse.py", args, { timeout: 60000 });
    const data = safeJsonParse(stdout, { mode, error: "parse failure" });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ mode, error: String(err) }, { status: 200 });
  }
}
