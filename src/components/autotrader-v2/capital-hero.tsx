"use client";
import * as React from "react";
import { Card, MetricTile, Pill, Skeleton, MoneyText } from "@/components/ui";
import { TrendingUp } from "lucide-react";

interface ClosedTrade {
  pnl_usd: number;
  closed_at: string;
  trade_mode?: string;
}

interface RootSnapshot {
  enabled: boolean;
  equity: number;
  open_positions: Array<unknown>;
  recent_trades: ClosedTrade[];
  stats_7d?: { total_pnl: number; total_trades: number };
  config?: Record<string, string>;
}

function parseUTC(ts: string): Date {
  // SQLite datetime('now') stores UTC without Z. Append T + Z if missing so
  // Date() doesn't interpret as local time.
  if (!ts) return new Date(NaN);
  let s = ts.includes("T") ? ts : ts.replace(" ", "T");
  if (!/Z$|[+-]\d\d:?\d\d$/.test(s)) s += "Z";
  return new Date(s);
}

export function CapitalHero() {
  const [data, setData] = React.useState<RootSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const fetchState = async () => {
      try {
        const res = await fetch("/api/auto-trader", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const j = (await res.json()) as RootSnapshot;
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
  const liveCap = parseFloat(
    data?.config?.LIVE_CAPITAL_USD ?? data?.config?.CAPITAL_USD ?? "0",
  );

  // "Today" = last 24h, matches audit's `closed_at >= datetime('now','-1 day')`
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const todayTrades = (data?.recent_trades ?? []).filter((t) => {
    const ts = parseUTC(t.closed_at);
    return Number.isFinite(ts.getTime()) && ts.getTime() >= cutoff;
  });
  const todayPnl = todayTrades.reduce((sum, t) => sum + (t.pnl_usd ?? 0), 0);
  const todayPct = liveCap > 0 ? (todayPnl / liveCap) * 100 : 0;
  const openCount = data?.open_positions?.length ?? 0;

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
              value={String(todayTrades.length)}
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
