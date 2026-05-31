"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  Pill,
  EmptyState,
  Skeleton,
  MoneyText,
} from "@/components/ui";
import { Activity, Clock, Target } from "lucide-react";

interface OpenPosition {
  id: number;
  ticker: string;
  direction: "LONG" | "SHORT";
  entry_price: number;
  stop_price: number;
  target_price: number;
  leverage: number;
  confidence: number;
  notional_usd: number;
  opened_at: string;
  peak_pnl_pct?: number | null;
  exit_signals_log?: string | null;
  trade_mode?: "live" | "paper";
}

interface OpenTradesResponse {
  type: "open";
  count: number;
  positions: OpenPosition[];
}

interface PriceMap {
  [ticker: string]: number;
}

interface PricesResponse {
  prices: Record<string, { price: number; source: string; stale: boolean }>;
}

const WATCH_TICKERS = ["BTC", "ETH", "SOL", "HYPE", "FARTCOIN", "XRP", "DOGE", "NEAR", "SUI", "kPEPE"];

function parseUTC(ts: string): Date {
  if (!ts) return new Date(NaN);
  let s = ts.includes("T") ? ts : ts.replace(" ", "T");
  if (!/Z$|[+-]\d\d:?\d\d$/.test(s)) s += "Z";
  return new Date(s);
}

function holdMin(opened_at: string): number {
  const ts = parseUTC(opened_at);
  if (!Number.isFinite(ts.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - ts.getTime()) / 60_000));
}

function fmtHold(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

export function ActivePositionCard() {
  const [positions, setPositions] = React.useState<OpenPosition[] | null>(null);
  const [prices, setPrices] = React.useState<PriceMap>({});
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    // Open positions come from a Python subprocess (slow) — keep at 15s.
    const fetchTrades = async () => {
      try {
        const snapRes = await fetch("/api/auto/trades?type=open&limit=10", {
          cache: "no-store",
        });
        if (snapRes.ok && !cancelled) {
          const j = (await snapRes.json()) as OpenTradesResponse;
          setPositions(j.positions ?? []);
        }
      } catch {
        /* keep last good state */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // LP-01 (2026-05-31): live price half polls at 2s so unrealized P&L
    // (recomputed below from entry + live price) ticks live. /api/prices serves
    // the WS-fed store → zero HL REST per poll; single persistent WS. The
    // expensive open-positions fetch stays at 15s.
    const fetchPrices = async () => {
      try {
        const priceRes = await fetch(
          `/api/prices?tickers=${WATCH_TICKERS.join(",")}`,
          { cache: "no-store" },
        );
        if (priceRes.ok && !cancelled) {
          const j = (await priceRes.json()) as PricesResponse;
          const pm: PriceMap = {};
          for (const [t, v] of Object.entries(j.prices ?? {})) {
            if (typeof v?.price === "number") pm[t] = v.price;
          }
          setPrices(pm);
        }
      } catch {
        /* keep last good state */
      }
    };

    fetchTrades();
    fetchPrices();
    const tradesId = setInterval(fetchTrades, 15_000);
    const pricesId = setInterval(fetchPrices, 2_000);
    return () => {
      cancelled = true;
      clearInterval(tradesId);
      clearInterval(pricesId);
    };
  }, []);

  const enriched = React.useMemo(() => {
    if (!positions) return [];
    return positions.map((p) => {
      const live = prices[p.ticker];
      let pnl_pct: number | null = null;
      if (live && p.entry_price) {
        const directional =
          p.direction === "LONG"
            ? live - p.entry_price
            : p.entry_price - live;
        pnl_pct = (directional / p.entry_price) * 100 * (p.leverage || 1);
      }
      return { ...p, current_price: live, pnl_pct };
    });
  }, [positions, prices]);

  return (
    <Card padding="md">
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2 uppercase tracking-wider">
            <Activity size={14} aria-hidden />
            Active · {positions?.length ?? 0}
          </span>
        </CardTitle>
      </CardHeader>

      {loading && <Skeleton className="h-20 w-full" />}

      {!loading && positions && positions.length === 0 && (
        <EmptyState
          title="No open positions"
          body="Awaiting next signal that clears the per-ticker threshold."
          className="min-h-[100px]"
        />
      )}

      {!loading && enriched.length > 0 && (
        <ul className="divide-y divide-border-subtle">
          {enriched.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {p.trade_mode && (
                    <Pill
                      intent={p.trade_mode === "live" ? "live" : "warn"}
                      size="sm"
                    >
                      {p.trade_mode}
                    </Pill>
                  )}
                  <span className="text-h3 font-bold tabular-nums">
                    {p.ticker}{" "}
                    <span
                      className={
                        p.direction === "LONG"
                          ? "text-accent-green"
                          : "text-accent-red"
                      }
                    >
                      {p.direction}
                    </span>
                  </span>
                </div>
                {typeof p.pnl_pct === "number" ? (
                  <MoneyText value={p.pnl_pct} unit="%" size="lg" showSign />
                ) : (
                  <span className="text-h3 text-fg-faint">—</span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-caption text-fg-muted">
                <span className="flex items-center gap-1 tabular-nums">
                  <Target size={12} aria-hidden />
                  entry ${fmtPrice(p.entry_price)}
                </span>
                {p.current_price !== undefined && (
                  <span className="tabular-nums">
                    now ${fmtPrice(p.current_price)}
                  </span>
                )}
                <span className="tabular-nums">
                  {p.leverage}x · ${p.notional_usd?.toFixed(2)}
                </span>
                <span className="flex items-center gap-1 tabular-nums">
                  <Clock size={12} aria-hidden />
                  {fmtHold(holdMin(p.opened_at))}
                </span>
                {typeof p.peak_pnl_pct === "number" && p.peak_pnl_pct !== 0 && (
                  <span className="flex items-center gap-1">
                    peak
                    <MoneyText
                      value={p.peak_pnl_pct}
                      unit="%"
                      size="sm"
                      decimals={2}
                      showSign
                    />
                  </span>
                )}
              </div>

              {p.exit_signals_log && (
                <div className="font-sans text-micro text-fg-muted">
                  exit hint:{" "}
                  <span className="font-mono text-accent-cyan-soft">
                    {p.exit_signals_log.slice(0, 80)}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
