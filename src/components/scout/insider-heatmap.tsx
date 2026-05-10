"use client";

import { useMemo, useState } from "react";
import { Card, EmptyState, Pill, Skeleton } from "@/components/ui";
import { ArrowDownRight, ArrowUpRight, Flame, RefreshCw, Snowflake } from "lucide-react";
import { cn } from "@/lib/utils";
import { useScoutFetch } from "./use-fetch";
import { fetchInsiders } from "./api";
import { finvizUrl, formatDateOnly } from "./format";
import type { InsiderHeatmapRow } from "./types";

/**
 * The /insiders endpoint returns rows aggregated by (ticker, role, code)
 * over the requested days — there is no weekly granularity. So instead of
 * a true week-by-week heatmap, we surface "Top buyers" and "Top sellers"
 * as two parallel ranked lists with bar-encoded values. Each row is the
 * net trade group for a (ticker × role × side) tuple.
 */

function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${Math.round(value).toLocaleString()}`;
}

function shortRole(role: string | null | undefined): string {
  if (!role) return "—";
  return role.replace(/\s*\(.*?\)\s*/g, "").trim();
}

export function InsiderHeatmap() {
  const [days, setDays] = useState(30);
  const { data, error, loading, refresh } = useScoutFetch(
    (signal) => fetchInsiders({ days, signal }),
    [days],
    { refreshMs: 60_000 },
  );

  const { buyers, sellers, totals } = useMemo(() => {
    const rows = data?.heatmap_data ?? [];
    const buys: InsiderHeatmapRow[] = [];
    const sells: InsiderHeatmapRow[] = [];
    let totalBuy = 0;
    let totalSell = 0;
    for (const r of rows) {
      if (r.transaction_code === "P") {
        buys.push(r);
        totalBuy += r.total_value || 0;
      } else if (r.transaction_code === "S") {
        sells.push(r);
        totalSell += r.total_value || 0;
      }
    }
    buys.sort((a, b) => (b.total_value ?? 0) - (a.total_value ?? 0));
    sells.sort((a, b) => (b.total_value ?? 0) - (a.total_value ?? 0));
    return {
      buyers: buys,
      sellers: sells,
      totals: { buy: totalBuy, sell: totalSell },
    };
  }, [data]);

  const maxBuy = buyers[0]?.total_value ?? 1;
  const maxSell = sellers[0]?.total_value ?? 1;

  return (
    <Card padding="none" className="overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-h3 text-fg-primary">INSIDERS</h2>
          <span className="text-caption text-fg-muted">
            {(buyers.length + sellers.length).toLocaleString()} groups · last {days}d
          </span>
        </div>
        <div className="flex items-center gap-2">
          <DaysChips days={days} setDays={setDays} />
          <button
            type="button"
            onClick={refresh}
            className="rounded-pill border border-border-subtle px-2 py-0.5 text-fg-muted transition-colors duration-fast hover:border-border-strong hover:text-accent-cyan"
            aria-label="Refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 divide-x divide-border-subtle border-b border-border-subtle">
        <div className="flex items-center gap-2 px-4 py-2 text-caption">
          <Flame className="h-3 w-3 text-accent-green" />
          <span className="text-fg-muted">Total purchases</span>
          <span className="ml-auto tabular-nums text-accent-green">{formatMoney(totals.buy)}</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 text-caption">
          <Snowflake className="h-3 w-3 text-accent-red" />
          <span className="text-fg-muted">Total sales</span>
          <span className="ml-auto tabular-nums text-accent-red">{formatMoney(totals.sell)}</span>
        </div>
      </div>

      {error && (
        <div className="border-b border-border-red bg-accent-red/5 px-4 py-2 text-caption text-accent-red">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-1 gap-4 p-3 lg:grid-cols-2">
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </div>
      ) : buyers.length === 0 && sellers.length === 0 ? (
        <EmptyState
          icon={<ArrowUpRight className="h-8 w-8 opacity-30" />}
          title="No insider activity"
          body={`No P/S trades recorded in the last ${days} days.`}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-border-subtle">
          <SideList
            title="TOP BUYERS"
            rows={buyers}
            max={maxBuy}
            color="green"
            empty="no purchases"
          />
          <SideList
            title="TOP SELLERS"
            rows={sellers}
            max={maxSell}
            color="red"
            empty="no sales"
          />
        </div>
      )}
    </Card>
  );
}

function SideList({
  title,
  rows,
  max,
  color,
  empty,
}: {
  title: string;
  rows: InsiderHeatmapRow[];
  max: number;
  color: "green" | "red";
  empty: string;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2 text-micro uppercase tracking-wider text-fg-muted">
        {color === "green" ? (
          <ArrowUpRight className="h-3 w-3 text-accent-green" />
        ) : (
          <ArrowDownRight className="h-3 w-3 text-accent-red" />
        )}
        <span>{title}</span>
        <span className="ml-auto text-fg-dim">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-caption text-fg-muted">{empty}</div>
      ) : (
        <ul>
          {rows.slice(0, 20).map((r, i) => {
            const value = r.total_value ?? 0;
            const widthPct = max > 0 ? (value / max) * 100 : 0;
            return (
              <li
                key={`${r.ticker}-${r.insider_role}-${r.transaction_code}-${i}`}
                className="relative border-b border-border-subtle px-4 py-2 transition-colors duration-fast hover:bg-bg-elevated/60"
              >
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute inset-y-0 left-0 rounded-r-sm",
                    color === "green" ? "bg-accent-green/10" : "bg-accent-red/10",
                  )}
                  style={{ width: `${widthPct}%` }}
                />
                <div className="relative flex items-center justify-between gap-2">
                  <a
                    href={finvizUrl(r.ticker)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-fg-primary hover:text-accent-cyan"
                  >
                    {r.ticker}
                  </a>
                  <Pill tone="neutral" size="sm">{shortRole(r.insider_role) || "—"}</Pill>
                  <span
                    className={cn(
                      "ml-auto tabular-nums",
                      color === "green" ? "text-accent-green" : "text-accent-red",
                    )}
                  >
                    {formatMoney(value)}
                  </span>
                </div>
                <div className="relative mt-0.5 flex items-center justify-between text-micro text-fg-muted">
                  <span>{r.trade_count} trade{r.trade_count === 1 ? "" : "s"}</span>
                  <span className="text-fg-dim">
                    {formatDateOnly(r.earliest)}
                    {r.latest && r.latest !== r.earliest && ` → ${formatDateOnly(r.latest)}`}
                  </span>
                </div>
              </li>
            );
          })}
          {rows.length > 20 && (
            <li className="px-4 py-2 text-center text-micro text-fg-dim">
              showing 20 of {rows.length}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function DaysChips({
  days,
  setDays,
}: {
  days: number;
  setDays: (n: number) => void;
}) {
  const opts = [7, 14, 30, 60, 90] as const;
  return (
    <div className="flex items-center gap-1">
      {opts.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => setDays(d)}
          className={cn(
            "rounded-pill border px-2 py-0.5 text-micro uppercase tracking-wider transition-colors duration-fast",
            d === days
              ? "border-border-accent bg-accent-cyan/10 text-accent-cyan"
              : "border-border-subtle text-fg-muted hover:border-border-strong hover:text-fg-primary",
          )}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}
