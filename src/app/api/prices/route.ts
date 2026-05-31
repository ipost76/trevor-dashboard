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

// LP-01 (2026-05-31): the Observatory aiohttp endpoint (:3335) serves live HL
// allMids from its single persistent WebSocket (one WS for the whole system,
// regardless of UI poll rate). When fresh we serve from it → ZERO HL REST per
// poll, so the 2s client cadence never touches Hyperliquid. When stale/down/
// incomplete we fall through to the EXISTING 30s-cached HL→CG SWR chain below,
// byte-identical to the prior contract (incl. per-ticker `stale`). The 30s
// cache stays the REST safety net — the WS feeds on top of it, never replaces it.
const OBSERVATORY_PRICES_URL = "http://127.0.0.1:3335/api/prices";

interface WsPriceState {
  stale: boolean;
  mids: Record<string, string>;
}

// Try the WS feed. Returns a complete PriceMap ONLY when the feed is fresh AND
// covers every requested ticker (case-insensitive, HL uses mixed-case "kPEPE");
// otherwise null → caller falls back to the cached REST chain. Never throws.
async function tryWsPrices(tickers: string[]): Promise<PriceMap | null> {
  try {
    const res = await fetch(OBSERVATORY_PRICES_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const state = (await res.json()) as WsPriceState;
    if (state.stale || !state.mids) return null;
    const byUpper: Record<string, number> = {};
    for (const [sym, val] of Object.entries(state.mids)) {
      const px = parseFloat(val);
      if (Number.isFinite(px) && px > 0) byUpper[sym.toUpperCase()] = px;
    }
    const out: PriceMap = {};
    for (const t of tickers) {
      const px = byUpper[t.toUpperCase()];
      if (!px) return null; // incomplete coverage → defer to the REST chain
      out[t] = { price: px, source: "hyperliquid", stale: false };
    }
    return out;
  } catch {
    return null; // unreachable / timeout / parse error → REST fallback
  }
}

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

  // LP-01: WS-first. When the Observatory feed is fresh + complete, serve it
  // directly (no HL REST, no SWR cache touched). On stale/down/incomplete this
  // returns null and we fall through to the unchanged cached REST chain below —
  // so the fallback path's `stale` semantics stay byte-identical to the prior
  // contract. Response shape identical either way.
  const wsPrices = await tryWsPrices(tickers);
  if (wsPrices) {
    return NextResponse.json({
      prices: wsPrices,
      timestamp: new Date().toISOString(),
    });
  }

  // Cache key = normalized (sorted) ticker set. Case-sensitive so response keys
  // keep the caller's exact casing; all three production callers (PriceStrip,
  // watchlist-grid, active-position-card) send the identical 10-ticker array, so
  // they collapse onto a single in-flight refresh per 30s window.
  const key = [...tickers].sort().join(",");

  const { value, stale, ts } = await pricesCache.swr(key, (prev) => computePrices(tickers, prev));

  // Build the response in request order. When serving a stale (expired) payload
  // during background revalidation, mark every entry stale:true (clients already
  // render stale:true). Response shape is byte-identical to the prior contract:
  // { prices: { <ticker>: { price, source, stale } }, timestamp }.
  const result: PriceMap = {};
  for (const t of tickers) {
    const entry = value[t] || { price: 0, source: "none", stale: true };
    result[t] = stale ? { ...entry, stale: true } : entry;
  }

  return NextResponse.json({ prices: result, timestamp: new Date(ts).toISOString() });
}
