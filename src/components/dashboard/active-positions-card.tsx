"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  Pill,
  Skeleton,
  EmptyState,
  MoneyText,
} from "@/components/ui";
import { Activity } from "lucide-react";

interface Position {
  id: string;
  system: "auto" | "scalp" | "degen";
  ticker: string;
  direction: "LONG" | "SHORT";
  entry_price: number;
  current_price: number | null;
  pnl_pct: number | null;
  pnl_usd: number | null;
  leverage: number;
  hold_minutes: number;
  opened_at: string;
  exit_strategy_hint: string | null;
}

interface ActiveResponse {
  count: number;
  positions: ReadonlyArray<Position>;
}

interface PriceMap {
  [ticker: string]: number;
}

function formatHold(min: number) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${m > 0 ? ` ${m}m` : ""}`;
}

function pillToneFor(system: Position["system"]): "green" | "cyan" | "magenta" {
  if (system === "auto") return "green";
  if (system === "scalp") return "cyan";
  return "magenta";
}

function directionTone(dir: "LONG" | "SHORT") {
  return dir === "LONG" ? "text-accent-green" : "text-accent-red";
}

export function ActivePositionsCard() {
  const [data, setData] = React.useState<ActiveResponse | null>(null);
  const [prices, setPrices] = React.useState<PriceMap>({});
  const [loading, setLoading] = React.useState(true);

  const fetchAll = React.useCallback(async () => {
    setLoading(true);
    try {
      // Build price-fetch ticker list from current positions when known;
      // first call falls back to default (BTC,ETH,SOL).
      const tickers =
        data && data.positions.length > 0
          ? Array.from(new Set(data.positions.map((p) => p.ticker))).join(",")
          : undefined;
      const priceUrl = tickers
        ? `/api/prices?tickers=${encodeURIComponent(tickers)}`
        : "/api/prices";

      const [activeRes, priceRes] = await Promise.all([
        fetch("/api/dashboard/active", { cache: "no-store" }),
        fetch(priceUrl, { cache: "no-store" }),
      ]);

      if (activeRes.ok) {
        setData(await activeRes.json());
      }

      if (priceRes.ok) {
        const pj = (await priceRes.json()) as {
          prices?: Record<string, { price: number }>;
        };
        // C1 (2026-04-29): /api/prices returns OBJECT { ticker: { price, source, stale } },
        // not array. Use Object.entries — this fix differs from the prompt template.
        const pm: PriceMap = {};
        for (const [ticker, info] of Object.entries(pj.prices ?? {})) {
          if (info && typeof info.price === "number") pm[ticker] = info.price;
        }
        setPrices(pm);
      }
    } finally {
      setLoading(false);
    }
  }, [data]);

  React.useEffect(() => {
    fetchAll();
    // deliberately omit fetchAll from deps to avoid re-loop on every fetch;
    // we want a one-shot mount fetch + the 15s interval below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const id = setInterval(() => {
      fetchAll();
    }, 15_000);
    return () => clearInterval(id);
  }, [fetchAll]);

  const enriched: Position[] = React.useMemo(() => {
    if (!data) return [];
    return data.positions.map((p) => {
      const live = prices[p.ticker];
      if (live && p.entry_price) {
        const directional =
          p.direction === "LONG"
            ? live - p.entry_price
            : p.entry_price - live;
        const pnl_pct = (directional / p.entry_price) * 100 * p.leverage;
        return { ...p, current_price: live, pnl_pct };
      }
      return p;
    });
  }, [data, prices]);

  return (
    <Card padding="md">
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2">
            <Activity size={14} />
            ACTIVE · {data?.count ?? 0}
          </span>
        </CardTitle>
      </CardHeader>

      {loading && !data && (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {!loading && data && data.count === 0 && (
        <EmptyState
          title="No active positions"
          body="Awaiting next signal. Bot remains live."
          className="min-h-[120px]"
        />
      )}

      {!loading && data && data.count > 0 && (
        <ul className="divide-y divide-border-subtle">
          {enriched.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Pill tone={pillToneFor(p.system)} size="sm">
                  {p.system}
                </Pill>
                <div className="flex min-w-0 flex-col">
                  <span className="text-body font-bold">
                    {p.ticker}{" "}
                    <span className={directionTone(p.direction)}>
                      {p.direction}
                    </span>
                  </span>
                  <span className="text-micro text-fg-muted">
                    {p.leverage}x · {formatHold(p.hold_minutes)} · entry $
                    {p.entry_price.toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="text-right">
                {typeof p.pnl_pct === "number" ? (
                  <MoneyText value={p.pnl_pct} unit="%" size="md" showSign />
                ) : (
                  <span className="text-body text-fg-faint">—</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
