"use client";

import { useState, useEffect, memo } from "react";
import { LiveValue } from "@/components/ui/live-value";
import { useLiveMark } from "@/lib/hl-ws-store";
import { useLiveTerminal } from "@/lib/live-terminal";

const TICKERS = ["BTC", "ETH", "SOL", "HYPE", "FARTCOIN", "XRP", "DOGE", "NEAR", "SUI", "kPEPE"];

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
}

/**
 * One price cell. Hook called UNCONDITIONALLY, gated by `live` — flag-OFF opens
 * no socket; the strip + watchlist share the ONE singleton WS when on. Flag OFF
 * is byte-identical to the prior inline span (incl. the `price ? … : "—"`
 * truthiness and the fg-primary/fg-faint color split); flag ON renders a
 * flashing <LiveValue> off the live mark, falling back to the /api/prices value.
 */
const PriceStripCell = memo(function PriceStripCell({
  ticker,
  apiPrice,
  hasPrices,
  live,
}: {
  ticker: string;
  apiPrice: number | undefined;
  hasPrices: boolean;
  live: boolean;
}) {
  const liveMark = useLiveMark(ticker, live);
  const price = live && liveMark.price != null ? liveMark.price : apiPrice;

  if (live) {
    return (
      <LiveValue
        value={price ?? null}
        format={(n) => `$${formatPrice(n)}`}
        className="text-[10px]"
      />
    );
  }

  // OFF-path: byte-identical to today.
  return (
    <span
      className={`text-[10px] tabular-nums ${
        hasPrices ? "text-fg-primary" : "text-fg-faint"
      }`}
    >
      {price ? `$${formatPrice(price)}` : "—"}
    </span>
  );
});

export default function PriceStrip() {
  const live = useLiveTerminal();
  const [prices, setPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const res = await fetch(`/api/prices?tickers=${TICKERS.join(",")}`);
        const data = await res.json();
        const p: Record<string, number> = {};
        for (const [k, v] of Object.entries(data.prices || {})) {
          p[k] = (v as { price: number }).price;
        }
        setPrices(p);
      } catch { /* ignore */ }
    };
    // LP-01 (2026-05-31): ~2s live cadence. /api/prices serves the WS-fed store
    // (zero HL REST per poll); only falls back to the 30s-cached REST chain when
    // the WS feed is stale. Single persistent WS regardless of this rate.
    // PERF-06 (2026-06-03): self-scheduling timeout with ±0–400ms jitter per tick
    // (re-randomized each tick) so this strip and active-position-card's identical
    // 2s /api/prices poll stop firing in lockstep (coordinated 2s bursts).
    // Pure burst-flattening; effective cadence ~2.2s avg, behavior unchanged.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(async () => {
        await fetchPrices();
        if (!cancelled) schedule();
      }, 2_000 + Math.random() * 400);
    };
    fetchPrices();
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const hasPrices = Object.keys(prices).length > 0;

  return (
    <div
      className="shrink-0 h-6 flex items-center overflow-x-auto scrollbar-hide bg-bg-sidebar border-b border-border-subtle"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      <div className="flex items-center gap-0 px-3 h-full font-mono">
        {TICKERS.map((ticker, i) => (
          <span
            key={ticker}
            className="flex items-center gap-1 shrink-0 whitespace-nowrap"
          >
            {i > 0 && (
              <span className="text-[10px] mx-2 text-fg-faint">·</span>
            )}
            <span className="text-[10px] font-semibold text-fg-muted">
              {ticker}
            </span>
            <PriceStripCell
              ticker={ticker}
              apiPrice={prices[ticker]}
              hasPrices={hasPrices}
              live={live}
            />
          </span>
        ))}
      </div>
    </div>
  );
}
