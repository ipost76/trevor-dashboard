"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, Pill, Skeleton } from "@/components/ui";
import { Eye } from "lucide-react";

type Tier = "BLUE_CHIP" | "MID_CAP" | "MEME";

interface Threshold {
  ticker: string;
  tier: Tier;
  quiet: number;
  normal: number;
  active: number;
}

interface AutoConfigResponse {
  per_ticker_thresholds_enabled: boolean;
  per_ticker_thresholds: Threshold[];
  data_available: boolean;
}

interface PriceMap {
  [ticker: string]: number;
}

interface PricesResponse {
  prices: Record<string, { price: number; source: string; stale: boolean }>;
}

const TIER_INTENT: Record<Tier, "blue-chip" | "mid-cap" | "meme"> = {
  BLUE_CHIP: "blue-chip",
  MID_CAP: "mid-cap",
  MEME: "meme",
};

const WATCH_TICKERS = ["BTC", "ETH", "SOL", "HYPE", "FARTCOIN", "XRP", "DOGE", "NEAR", "SUI", "kPEPE"];

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

export function WatchlistGrid() {
  const [thresholds, setThresholds] = React.useState<Threshold[] | null>(null);
  const [prices, setPrices] = React.useState<PriceMap>({});
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      try {
        const [tRes, pRes] = await Promise.all([
          fetch("/api/auto/config", { cache: "no-store" }),
          fetch(`/api/prices?tickers=${WATCH_TICKERS.join(",")}`, {
            cache: "no-store",
          }),
        ]);

        if (tRes.ok && !cancelled) {
          const j = (await tRes.json()) as AutoConfigResponse;
          setThresholds(j.per_ticker_thresholds ?? []);
        }
        if (pRes.ok && !cancelled) {
          const j = (await pRes.json()) as PricesResponse;
          const pm: PriceMap = {};
          for (const [t, v] of Object.entries(j.prices ?? {})) {
            if (typeof v?.price === "number") pm[t] = v.price;
          }
          setPrices(pm);
        }
      } catch {
        /* keep last good state */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchAll();
    const id = setInterval(fetchAll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <Card padding="md">
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2 uppercase tracking-wider">
            <Eye size={14} aria-hidden />
            Watchlist
          </span>
        </CardTitle>
      </CardHeader>

      {loading && (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {!loading && thresholds && thresholds.length === 0 && (
        <div className="py-6 text-center text-caption text-fg-muted">
          Per-ticker thresholds unavailable.
        </div>
      )}

      {!loading && thresholds && thresholds.length > 0 && (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {thresholds.map((t) => {
            const livePrice = prices[t.ticker];
            return (
              <li
                key={t.ticker}
                className="flex flex-col gap-1.5 rounded-md border border-accent-cyan-soft-subtle bg-bg-elevated p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-h3 font-bold tabular-nums">
                    {t.ticker}
                  </span>
                  <Pill intent={TIER_INTENT[t.tier]} size="sm">
                    {t.tier}
                  </Pill>
                </div>

                {livePrice !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-body tabular-nums text-fg-primary">
                      ${fmtPrice(livePrice)}
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-1 pt-1 text-micro tabular-nums">
                  <div className="text-center">
                    <div className="font-sans uppercase tracking-wider text-fg-faint">QUIET</div>
                    <div className="font-mono text-fg-primary">{t.quiet.toFixed(0)}</div>
                  </div>
                  <div className="text-center">
                    <div className="font-sans uppercase tracking-wider text-fg-faint">NORMAL</div>
                    <div className="font-mono text-fg-primary">{t.normal.toFixed(0)}</div>
                  </div>
                  <div className="text-center">
                    <div className="font-sans uppercase tracking-wider text-fg-faint">ACTIVE</div>
                    <div className="font-mono text-fg-primary">{t.active.toFixed(0)}</div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
