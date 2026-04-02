import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

// In-memory cache (30s TTL)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _lbCache: { data: any; ts: number } | null = null;
const LB_CACHE_TTL = 30_000;

export async function GET() {
  if (_lbCache && (Date.now() - _lbCache.ts) < LB_CACHE_TTL) {
    return NextResponse.json({ ..._lbCache.data, cached: true });
  }

  try {
    const raw = runPython("query_live_board.py", ["read"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = safeJsonParse<{ tickers: any[]; last_scan: string | null }>(raw, { tickers: [], last_scan: null });

    // Overlay fresh prices from Hyperliquid
    try {
      const hlRes = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "allMids" }),
        signal: AbortSignal.timeout(5000),
      });
      if (hlRes.ok) {
        const allMids = await hlRes.json();
        for (const t of data.tickers) {
          const freshPrice = allMids[t.ticker];
          if (freshPrice) {
            t.current_price = parseFloat(freshPrice);
          }
        }
      }
    } catch {
      // Hyperliquid fetch failed — use DB prices (stale but acceptable)
    }

    _lbCache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { tickers: [], last_scan: null, error: String(err) },
      { status: 500 }
    );
  }
}
