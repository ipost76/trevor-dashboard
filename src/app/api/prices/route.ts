import { NextRequest, NextResponse } from "next/server";
import { createSwrCache } from "@/lib/single-flight";

export const dynamic = "force-dynamic";

const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", HYPE: "hyperliquid",
  FARTCOIN: "fartcoin", DOGE: "dogecoin", LINK: "chainlink", AVAX: "avalanche-2",
  PEPE: "pepe", WIF: "dogwifcoin", BONK: "bonk", DOT: "polkadot",
  // RM-07 P02 (2026-05-28): sacred-ticker expansion CoinGecko backups.
  // XRP/NEAR/SUI map 1:1. kPEPE is intentionally omitted — it is HL's
  // 1000x-denominated PEPE perp, so CoinGecko "pepe" (raw price) would read
  // ~1000x too low; kPEPE is sourced from Hyperliquid only (HL quotes it at
  // the correct k-denominated price).
  XRP: "ripple", NEAR: "near", SUI: "sui",
};

type PriceEntry = { price: number; source: string; stale: boolean };
type PriceMap = Record<string, PriceEntry>;

// W-H-P4-HUB (2026-06-09): the WS-first path to the Observatory aiohttp endpoint
// at :3335 was REMOVED. That source is DEAD on the WSL Hub box (W-E-P2b moved the
// Observatory to :8443, which serves /api/heartbeat but NOT a prices/allMids
// endpoint — verified 404), so every poll wasted a doomed connection and the
// per-ticker `stale` flag never reflected reality. The 30s-cached HL→CG SWR chain
// below — which already works and tracks live HL within ~0.04% — is now the SOLE,
// PRIMARY source. Staleness is judged by the WALL-CLOCK AGE of the served value
// (PRICE_STALE_AGE_MS), mirroring the W-H-P2/P3-HUB equity-badge fix, so a value
// that is merely mid-refresh (~30-60s old, perfectly good at the ~30s cadence) is
// no longer falsely flagged stale on the one poll per 30s window that lands on the
// SWR TTL boundary.

// A served price is only "stale" once it is genuinely old — i.e. the 30s SWR
// revalidation has failed to land for >3 cadence windows. 90s sits well above the
// ~30s refresh cadence, so steady-state polling is never falsely flagged, while a
// genuinely stalled HL+CG chain (no successful refresh for >90s) correctly shows
// stale. Mirrors EQUITY_STALE_AGE_MS in src/app/api/auto/state/route.ts.
const PRICE_STALE_AGE_MS = 90_000;

// 30s read-through cache keyed by the normalized ticker set, with single-flight
// dedup + stale-while-revalidate + a per-origin (HL/CG) concurrency cap (RM-DASH
// 2026-05-29 — kills the cache-stampede wedge: the synchronous JSON.parse of HL's
// full allMids now runs ONCE per window per key, not once per concurrent request).
const pricesCache = createSwrCache<PriceMap>({ defaultTtl: 30_000, concurrency: 2 });

async function fetchHyperliquid(): Promise<Record<string, number>> {
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "allMids" }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HL ${res.status}`);
  const data = await res.json();
  const prices: Record<string, number> = {};
  for (const [sym, val] of Object.entries(data)) {
    prices[sym] = parseFloat(val as string);
  }
  return prices;
}

async function fetchCoinGecko(tickers: string[]): Promise<Record<string, number>> {
  // Map each requested ticker (original casing preserved) to its CoinGecko id
  // via a case-insensitive lookup, then key results back by the requested
  // string so callers read prices by the exact ticker they passed.
  const pairs: Array<[string, string]> = [];
  for (const t of tickers) {
    const id = COINGECKO_IDS[t.toUpperCase()];
    if (id) pairs.push([t, id]);
  }
  if (!pairs.length) return {};
  const ids = [...new Set(pairs.map(([, id]) => id))];
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`CG ${res.status}`);
  const data = await res.json();
  const prices: Record<string, number> = {};
  for (const [ticker, cgId] of pairs) {
    if (data[cgId]?.usd) prices[ticker] = data[cgId].usd;
  }
  return prices;
}

// The full HL→CG miss-chain, wrapped by the single-flight cache. NEVER throws —
// HL/CG failures degrade per-ticker to the prior cached value (marked stale) or a
// zero placeholder, exactly as the pre-dedup route did. `prev` is the prior cached
// payload for this same ticker set (the value the single-flight cache holds).
async function computePrices(tickers: string[], prev: PriceMap | undefined): Promise<PriceMap> {
  // Observability: ONE line per ACTUAL upstream refresh. Single-flight guarantees
  // this runs at most once per ticker-set per 30s window — so the count of these
  // lines under load is the number of upstream chains (the stampede-dedup signal).
  console.log(`[PRICES] upstream refresh — tickers=[${tickers.join(",")}]`);
  const prices: PriceMap = {};

  // Try Hyperliquid first (case-insensitive symbol match — HL uses mixed-case
  // symbols like "kPEPE"; results are keyed by the caller's original casing).
  try {
    const hl = await fetchHyperliquid();
    const hlByUpper: Record<string, number> = {};
    for (const [sym, px] of Object.entries(hl)) hlByUpper[sym.toUpperCase()] = px;
    for (const t of tickers) {
      const px = hlByUpper[t.toUpperCase()];
      if (px) prices[t] = { price: px, source: "hyperliquid", stale: false };
    }
  } catch (e) {
    console.error("[PRICES] Hyperliquid failed:", e);
  }

  // CoinGecko backup for missing tickers
  const missing = tickers.filter((t) => !prices[t]);
  if (missing.length > 0) {
    try {
      const cg = await fetchCoinGecko(missing);
      for (const t of missing) {
        if (cg[t]) prices[t] = { price: cg[t], source: "coingecko", stale: false };
      }
    } catch (e) {
      console.error("[PRICES] CoinGecko failed:", e);
    }
  }

  // Fill remaining from the prior payload for this ticker set (marked stale).
  for (const t of tickers) {
    if (!prices[t]) {
      const old = prev?.[t];
      prices[t] = old ? { ...old, stale: true } : { price: 0, source: "none", stale: true };
    }
  }

  return prices;
}

export async function GET(request: NextRequest) {
  const tickerParam = request.nextUrl.searchParams.get("tickers") || "BTC,ETH,SOL";
  // Preserve original casing — HL symbols can be mixed-case (e.g. "kPEPE", the
  // 1000x PEPE perp). Symbol matching is case-insensitive; the response is keyed
  // by the exact strings the caller passed, so callers read prices back by the
  // same ticker they requested.
  const tickers = tickerParam.split(",").map((t) => t.trim());

  // W-H-P4-HUB: WS-first path removed (dead :3335). The 30s SWR HL→CG chain is the
  // sole source. Cache key = normalized (sorted) ticker set. Case-sensitive so
  // response keys keep the caller's exact casing; all production callers
  // (PriceStrip, watchlist-grid, active-position-card) send the identical ticker
  // array, so they collapse onto a single in-flight refresh per 30s window.
  const key = [...tickers].sort().join(",");

  const { value, ts } = await pricesCache.swr(key, (prev) => computePrices(tickers, prev));

  // W-H-P4-HUB: per-ticker staleness is now AGE-based, not the SWR per-call flag.
  // The SWR flag is `true` on every poll that lands after the 30s TTL expires —
  // even though the served value is only ~30s old and perfectly good — which
  // produced a false "stale" blip once per 30s window. Flag stale only when the
  // served payload is genuinely old (age > PRICE_STALE_AGE_MS) OR when the
  // per-ticker entry itself is a degraded fallback (computePrices already marks a
  // ticker stale:true when HL+CG both failed and it served a prior/zero value).
  // Response shape unchanged: { prices: { <ticker>: { price, source, stale } },
  // timestamp }.
  const ageStale = Date.now() - ts > PRICE_STALE_AGE_MS;
  const result: PriceMap = {};
  for (const t of tickers) {
    const entry = value[t] || { price: 0, source: "none", stale: true };
    result[t] = { ...entry, stale: entry.stale || ageStale };
  }

  return NextResponse.json({ prices: result, timestamp: new Date(ts).toISOString() });
}
