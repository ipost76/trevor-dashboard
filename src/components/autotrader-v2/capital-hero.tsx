"use client";
import * as React from "react";
import { Card, MetricTile, Pill, Skeleton, MoneyText } from "@/components/ui";
import { TrendingUp } from "lucide-react";

interface AutoState {
  capital_usd: number;
  live_capital_usd: number;
  equity: number;
  pnl_today_usd: number;
  pnl_today_pct: number;
  trades_today: number;
  open_positions_count: number;
  data_available: boolean;
}

export function CapitalHero() {
  const [data, setData] = React.useState<AutoState | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const fetchState = async () => {
      try {
        const res = await fetch("/api/auto/state", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const j = (await res.json()) as AutoState;
        if (!cancelled) setData(j);
      } catch {
        /* keep last good state */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchState();
    const id = setInterval(fetchState, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const equity = data?.equity ?? 0;
  const liveCap = data?.live_capital_usd ?? data?.capital_usd ?? 0;
  const todayPnl = data?.pnl_today_usd ?? 0;
  const todayPct = data?.pnl_today_pct ?? 0;
  const todayCount = data?.trades_today ?? 0;
  const openCount = data?.open_positions_count ?? 0;

  return (
    <Card padding="lg" glow="cyan" className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-micro uppercase tracking-wider text-fg-muted">
          <TrendingUp size={12} aria-hidden />
          Auto Capital
        </span>
        <Pill tone="cyan" size="sm">
          EQUITY
        </Pill>
      </div>

      {loading && <Skeleton className="h-16 w-48" />}
      {!loading && data && (
        <>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="font-mono text-display font-bold tabular-nums text-fg-primary">
              ${equity.toFixed(2)}
            </span>
            {liveCap > 0 && (
              <span className="text-micro text-fg-muted">
                of ${liveCap.toFixed(0)} cap
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <MetricTile
              label="Today P&L"
              value={
                <MoneyText
                  value={todayPnl}
                  unit="$"
                  size="md"
                  decimals={2}
                  showSign
                />
              }
              sub={
                liveCap > 0 ? (
                  <MoneyText
                    value={todayPct}
                    unit="%"
                    size="sm"
                    decimals={2}
                    showSign
                  />
                ) : (
                  ""
                )
              }
            />
            <MetricTile
              label="Trades"
              value={String(todayCount)}
              sub="today"
            />
            <MetricTile
              label="Open"
              value={String(openCount)}
              sub="positions"
            />
          </div>
        </>
      )}
    </Card>
  );
}
