import { NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";

// /api/quality — Signal Quality Intelligence summary
//
// GET ?scope=summary (default)        → counts + top boost/block + source breakdown
// GET ?scope=patterns[&active=1]      → list patterns
// GET ?scope=ticker&ticker=BTC        → patterns matching ticker
// GET ?scope=regime&regime=TRENDING   → patterns matching regime
// GET ?scope=recent_matches[&limit=N] → recent signal->pattern matches
// GET ?scope=by_ticker                → heatmap data: WR by ticker × direction
// GET ?scope=by_regime                → WR by regime × direction
// GET ?scope=by_confidence            → calibration curve: WR by confidence bucket
//
// 60s in-memory cache per scope+args. Auth: middleware enforces session cookie.

export const dynamic = "force-dynamic";

const CACHE_TTL = 60_000;
const ALLOWED_SCOPES = new Set([
  "summary",
  "patterns",
  "ticker",
  "regime",
  "recent_matches",
  "by_ticker",
  "by_regime",
  "by_confidence",
]);

// RM-DASH 2026-05-29: single-flight + SWR keyed by scope+args, so a cold-cache
// burst across distinct scopes spawns at most ONE Python child per key per window
// (and at most `concurrency` concurrently). The route's existing try/catch around
// swr() preserves the prior cold-failure contract (500). This is the route that
// genuinely needs the keyed Map — multiple distinct cache keys are live at once.
const cache = createSwrCache<unknown>({ defaultTtl: CACHE_TTL, concurrency: 2 });

async function runHelper(args: string[]): Promise<unknown> {
  // Async bridge — argv, no shell interpolation, never blocks the event loop.
  const raw = await runPython("query_quality.py", args, { timeout: 15_000 });
  return JSON.parse(raw || "null");
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const scope = (url.searchParams.get("scope") || "summary").toLowerCase();
    if (!ALLOWED_SCOPES.has(scope)) {
      return NextResponse.json({ error: `unknown scope: ${scope}` }, { status: 400 });
    }
    const active = url.searchParams.get("active");
    const ticker = url.searchParams.get("ticker");
    const regime = url.searchParams.get("regime");
    const limit = url.searchParams.get("limit");

    let cacheKey = scope;
    let helperArgs: string[] = [scope];

    if (scope === "patterns") {
      if (active === "1" || active === "true") {
        helperArgs = ["patterns", "active"];
        cacheKey = "patterns_active";
      } else {
        helperArgs = ["patterns"];
      }
    } else if (scope === "ticker") {
      if (!ticker) {
        return NextResponse.json({ error: "missing ticker" }, { status: 400 });
      }
      helperArgs = ["ticker", ticker];
      cacheKey = `ticker_${ticker}`;
    } else if (scope === "regime") {
      if (!regime) {
        return NextResponse.json({ error: "missing regime" }, { status: 400 });
      }
      helperArgs = ["regime", regime];
      cacheKey = `regime_${regime}`;
    } else if (scope === "recent_matches") {
      const n = limit ? parseInt(limit, 10) : 20;
      const safeN = Number.isFinite(n) && n > 0 ? Math.min(n, 500) : 20;
      helperArgs = ["recent_matches", String(safeN)];
      cacheKey = `recent_matches_${safeN}`;
    }

    const { value } = await cache.swr(cacheKey, () => runHelper(helperArgs));
    return NextResponse.json(value);
  } catch (e) {
    return NextResponse.json(
      { error: String(e) },
      { status: 500 }
    );
  }
}

// NOTE: Cache invalidation after approve/reject is intentionally NOT wired up
// (Next.js doesn't allow custom exports from route files). The 60s TTL is short
// enough that stale data is brief; the panel waits ~800ms after POST before
// refetching, which usually returns fresh data because the helper round-trip
// is faster than the cache check race.
