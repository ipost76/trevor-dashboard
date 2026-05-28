"use client";

import { useState, useEffect } from "react";

const TICKERS = ["BTC", "ETH", "SOL", "HYPE", "FARTCOIN", "XRP", "DOGE", "NEAR", "SUI", "kPEPE"];

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
}

export default function PriceStrip() {
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
    fetchPrices();
    const iv = setInterval(fetchPrices, 30_000);
    return () => clearInterval(iv);
  }, []);

  const hasPrices = Object.keys(prices).length > 0;

  return (
    <div
      className="shrink-0 h-6 flex items-center overflow-x-auto scrollbar-hide bg-bg-sidebar border-b border-border-subtle"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      <div className="flex items-center gap-0 px-3 h-full font-mono">
        {TICKERS.map((ticker, i) => {
          const price = prices[ticker];
          return (
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
              <span
                className={`text-[10px] tabular-nums ${
                  hasPrices ? "text-fg-primary" : "text-fg-faint"
                }`}
              >
                {price ? `$${formatPrice(price)}` : "—"}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
