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
  FilterChips,
} from "@/components/ui";
import { History } from "lucide-react";

interface ClosedTrade {
  id: number;
  ticker: string;
  direction: "LONG" | "SHORT";
  pnl_pct: number;
  pnl_usd: number;
  hold_duration_minutes: number | null;
  closed_at: string;
  trade_mode: "live" | "paper";
  exit_reason?: string | null;
}

interface ClosedTradesResponse {
  type: "closed";
  count: number;
  trades: ClosedTrade[];
}

const SACRED_TICKERS: ReadonlyArray<string> = ["BTC", "ETH", "SOL", "HYPE", "FARTCOIN", "XRP", "DOGE", "NEAR", "SUI", "kPEPE"];
const DIRECTION_OPTIONS: ReadonlyArray<string> = ["ALL", "LONG", "SHORT"];
const OUTCOME_OPTIONS: ReadonlyArray<string> = ["ALL", "PROFITABLE", "LOSING"];

function fmtHold(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "—";
  const m = Math.max(0, Math.floor(min));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h}h` : `${h}h ${mm}m`;
}

function parseUTC(ts: string | null | undefined): Date {
  if (!ts) return new Date(NaN);
  let s = ts.includes("T") ? ts : ts.replace(" ", "T");
  if (!/Z$|[+-]\d\d:?\d\d$/.test(s)) s += "Z";
  return new Date(s);
}

function fmtClosedAt(ts: string | null | undefined): string {
  const d = parseUTC(ts);
  if (!Number.isFinite(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (sameDay) return time;
  const md = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${md} ${time}`;
}

export function RecentTab() {
  const [trades, setTrades] = React.useState<ClosedTrade[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [tickerFilter, setTickerFilter] = React.useState<string>("ALL");
  const [directionFilter, setDirectionFilter] = React.useState<string>("ALL");
  const [outcomeFilter, setOutcomeFilter] = React.useState<string>("ALL");

  React.useEffect(() => {
    let cancelled = false;
    const fetchTrades = async () => {
      try {
        const res = await fetch("/api/auto/trades?type=closed&limit=50", {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const j = (await res.json()) as ClosedTradesResponse;
        if (!cancelled) setTrades(j.trades ?? []);
      } catch {
        /* keep last good state */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchTrades();
    const id = setInterval(fetchTrades, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const tickerOptions = React.useMemo<string[]>(() => {
    const discovered = new Set<string>(SACRED_TICKERS);
    (trades ?? []).forEach((t) => discovered.add(t.ticker));
    return ["ALL", ...Array.from(discovered).sort()];
  }, [trades]);

  const filteredTrades = React.useMemo(() => {
    if (!trades) return [];
    return trades.filter((t) => {
      if (tickerFilter !== "ALL" && t.ticker !== tickerFilter) return false;
      if (directionFilter !== "ALL" && t.direction !== directionFilter) return false;
      if (outcomeFilter === "PROFITABLE" && !(t.pnl_pct > 0)) return false;
      if (outcomeFilter === "LOSING" && !(t.pnl_pct <= 0)) return false;
      return true;
    });
  }, [trades, tickerFilter, directionFilter, outcomeFilter]);

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <div className="space-y-3">
        <FilterChips
          options={tickerOptions}
          selected={tickerFilter}
          onChange={setTickerFilter}
          ariaLabel="Filter by ticker"
        />
        <FilterChips
          options={DIRECTION_OPTIONS}
          selected={directionFilter}
          onChange={setDirectionFilter}
          ariaLabel="Filter by direction"
        />
        <FilterChips
          options={OUTCOME_OPTIONS}
          selected={outcomeFilter}
          onChange={setOutcomeFilter}
          ariaLabel="Filter by outcome"
        />
      </div>

      <Card padding="md">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2 uppercase tracking-wider">
              <History size={14} aria-hidden />
              Recent Signals
              {trades && (
                <span className="ml-1 font-mono text-micro text-fg-muted">
                  {filteredTrades.length}/{trades.length}
                </span>
              )}
            </span>
          </CardTitle>
        </CardHeader>

        {loading && <Skeleton className="h-32 w-full" />}

        {!loading && filteredTrades.length === 0 && (
          <EmptyState
            title={trades && trades.length > 0 ? "No matches" : "No closed trades yet"}
            body={
              trades && trades.length > 0
                ? "Try widening filters."
                : "History appears after the first trade closes."
            }
            className="min-h-[80px]"
          />
        )}

        {!loading && filteredTrades.length > 0 && (
          <ul className="divide-y divide-border-subtle">
            {filteredTrades.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-2 py-2 text-caption"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Pill
                    intent={t.trade_mode === "live" ? "live" : "warn"}
                    size="sm"
                  >
                    {t.trade_mode}
                  </Pill>
                  <span className="font-bold tabular-nums">
                    {t.ticker}{" "}
                    <span
                      className={
                        t.direction === "LONG"
                          ? "text-accent-mint-strong"
                          : "text-accent-red"
                      }
                    >
                      {t.direction}
                    </span>
                  </span>
                  <span className="text-fg-muted tabular-nums">
                    {fmtHold(t.hold_duration_minutes)}
                  </span>
                  {t.closed_at && (
                    <span
                      className="font-mono text-fg-muted tabular-nums"
                      title={t.closed_at}
                    >
                      · {fmtClosedAt(t.closed_at)}
                    </span>
                  )}
                  {t.exit_reason && (
                    <span className="font-sans text-fg-faint">
                      · {t.exit_reason}
                    </span>
                  )}
                </div>
                <MoneyText value={t.pnl_pct} unit="%" size="md" showSign />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
