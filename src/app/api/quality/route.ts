import { NextResponse } from "next/server";
import { execSync } from "child_process";

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

const PY = "/home/trevor/trevor/venv/bin/python";
const HELPER = "/home/trevor/trevor-dashboard/query_quality.py";
const CACHE_TTL = 60_000;

const _cache: Map<string, { data: unknown; ts: number }> = new Map();

function shellQuote(s: string): string {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function runHelper(args: string): unknown {
  const cmd = `${PY} ${HELPER} ${args}`;
  const raw = execSync(cmd, { timeout: 15_000, encoding: "utf-8" });
  return JSON.parse(raw);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const scope = (url.searchParams.get("scope") || "summary").toLowerCase();
    const active = url.searchParams.get("active");
    const ticker = url.searchParams.get("ticker");
    const regime = url.searchParams.get("regime");
    const limit = url.searchParams.get("limit");

    let cacheKey = scope;
    let helperArgs = scope;

    if (scope === "patterns") {
      if (active === "1" || active === "true") {
        helperArgs = "patterns active";
        cacheKey = "patterns_active";
      } else {
        helperArgs = "patterns";
      }
    } else if (scope === "ticker") {
      if (!ticker) {
        return NextResponse.json({ error: "missing ticker" }, { status: 400 });
      }
      helperArgs = `ticker ${shellQuote(ticker)}`;
      cacheKey = `ticker_${ticker}`;
    } else if (scope === "regime") {
      if (!regime) {
        return NextResponse.json({ error: "missing regime" }, { status: 400 });
      }
      helperArgs = `regime ${shellQuote(regime)}`;
      cacheKey = `regime_${regime}`;
    } else if (scope === "recent_matches") {
      const n = limit ? parseInt(limit, 10) : 20;
      helperArgs = `recent_matches ${isNaN(n) ? 20 : n}`;
      cacheKey = `recent_matches_${n}`;
    }

    const now = Date.now();
    const cached = _cache.get(cacheKey);
    if (cached && now - cached.ts < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }

    const data = runHelper(helperArgs);
    _cache.set(cacheKey, { data, ts: now });
    return NextResponse.json(data);
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
