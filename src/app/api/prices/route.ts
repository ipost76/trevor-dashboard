import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", HYPE: "hyperliquid",
  FARTCOIN: "fartcoin", DOGE: "dogecoin", LINK: "chainlink", AVAX: "avalanche-2",
  PEPE: "pepe", WIF: "dogwifcoin", BONK: "bonk", DOT: "polkadot",
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
  const ids = tickers.map((t) => COINGECKO_IDS[t]).filter(Boolean);
  if (!ids.length) return {};
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`CG ${res.status}`);
  const data = await res.json();
  const prices: Record<string, number> = {};
  for (const [ticker, cgId] of Object.entries(COINGECKO_IDS)) {
    if (data[cgId]?.usd) prices[ticker] = data[cgId].usd;
  }
  return prices;
}

export async function GET(request: NextRequest) {
  const tickerParam = request.nextUrl.searchParams.get("tickers") || "BTC,ETH,SOL";
  const tickers = tickerParam.split(",").map((t) => t.trim().toUpperCase());

  // Return cache if fresh (30s)
  if (cache && Date.now() - cache.ts < 30_000) {
    const result: Record<string, { price: number; source: string; stale: boolean }> = {};
    for (const t of tickers) {
      result[t] = cache.data[t] || { price: 0, source: "none", stale: true };
    }
    return NextResponse.json({ prices: result, timestamp: new Date(cache.ts).toISOString() });
  }

  const prices: Record<string, { price: number; source: string; stale: boolean }> = {};

  // Try Hyperliquid first
  try {
    const hl = await fetchHyperliquid();
    for (const t of tickers) {
      if (hl[t]) prices[t] = { price: hl[t], source: "hyperliquid", stale: false };
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
