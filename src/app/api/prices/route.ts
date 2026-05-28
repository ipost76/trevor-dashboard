import { NextRequest, NextResponse } from "next/server";

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

let cache: { data: Record<string, { price: number; source: string; stale: boolean }>; ts: number } | null = null;

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

export async function GET(request: NextRequest) {
  const tickerParam = request.nextUrl.searchParams.get("tickers") || "BTC,ETH,SOL";
  // Preserve original casing — HL symbols can be mixed-case (e.g. "kPEPE", the
  // 1000x PEPE perp). Symbol matching below is case-insensitive; the response is
  // keyed by the exact strings the caller passed, so callers read prices back by
  // the same ticker they requested.
  const tickers = tickerParam.split(",").map((t) => t.trim());

  // Return cache if fresh (30s)
  if (cache && Date.now() - cache.ts < 30_000) {
    const result: Record<string, { price: number; source: string; stale: boolean }> = {};
    for (const t of tickers) {
      result[t] = cache.data[t] || { price: 0, source: "none", stale: true };
    }
    return NextResponse.json({ prices: result, timestamp: new Date(cache.ts).toISOString() });
  }

  const prices: Record<string, { price: number; source: string; stale: boolean }> = {};

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

  // Fill remaining from old cache
  for (const t of tickers) {
    if (!prices[t]) {
      const old = cache?.data[t];
      prices[t] = old ? { ...old, stale: true } : { price: 0, source: "none", stale: true };
    }
  }

  cache = { data: { ...(cache?.data || {}), ...prices }, ts: Date.now() };
  return NextResponse.json({ prices, timestamp: new Date().toISOString() });
}
