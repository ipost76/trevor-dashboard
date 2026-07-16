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
  pnl_pct: number | null;
  pnl_usd: number | null;
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

// B6-RECENT-GAPS: RECENT shows the most-recent closed-LIVE trades up to this cap
// (raised 50 → 200, the route's existing clamp ceiling). With >200 closed-live
// trades on record the cap is hit, so the UI surfaces a "list capped" notice —
// a real older trade can't silently fall off the list with no sign.
const RECENT_LIMIT = 200;

function fmtHold(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "—";
  const m = Math.max(0, Math.floor(min));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h}h` : `${h}h ${mm}m`;
}

// closed_at is stored as EASTERN-LOCAL naive wall-clock ("YYYY-MM-DD HH:MM:SS",
// no offset/Z) — written by Python datetime.now() on the America/New_York VM.
// Render the raw HH:MM slice (24h): the value is ALREADY Eastern, so do NOT
// parse it as UTC + re-localize — that was the 4-hour bug (15:21 EDT → 11:21).
// The raw slice is browser-timezone-independent (a phone in any tz shows the
// true ET close). A1 proof: created_at (SQLite CURRENT_TIMESTAMP = real UTC)
// == opened_at/closed_at + exactly 4h on every row. Guarded: null/short/
// malformed → "--:--" (never NaN, never an empty gap).
function fmtEastern(ts: string | null | undefined): string {
  if (typeof ts !== "string" || ts.length < 16) return "--:--";
  const hhmm = ts.slice(11, 16);
  return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : "--:--";
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
        const res = await fetch(`/api/auto/trades?type=closed&limit=${RECENT_LIMIT}`, {
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
      if (outcomeFilter === "PROFITABLE" && !(t.pnl_pct != null && t.pnl_pct > 0)) return false;
      if (outcomeFilter === "LOSING" && !(t.pnl_pct != null && t.pnl_pct <= 0)) return false;
      return true;
    });
  }, [trades, tickerFilter, directionFilter, outcomeFilter]);

  // B6-RECENT-GAPS: server returns at most RECENT_LIMIT closed rows. When the
  // returned set hits that cap, real older closed trades are hidden — surface it.
  const capped = (trades?.length ?? 0) >= RECENT_LIMIT;

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

        {trades && capped && (
          <p className="mb-3 font-sans text-micro text-accent-gold">
            List capped — showing {trades.length} most recent (older closed trades hidden).
          </p>
        )}

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
                className="flex items-start justify-between gap-3 py-2.5"
              >
                {/* left column — line 1 identity (bold), line 2 meta (one line, never wraps) */}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body font-bold tabular-nums text-fg-primary">
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
                  </div>
                  {/* HH:MM (raw Eastern) · duration · exit_reason — single line,
                      long reason ellipses (never wraps). min-w-0 is load-bearing
                      for truncate to work inside the flex child. */}
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-micro text-fg-muted tabular-nums">
                    <span className="shrink-0" title={t.closed_at}>
                      {fmtEastern(t.closed_at)}
                    </span>
                    <span className="shrink-0 text-fg-faint">·</span>
                    <span className="shrink-0">{fmtHold(t.hold_duration_minutes)}</span>
                    {t.exit_reason && (
                      <>
                        <span className="shrink-0 text-fg-faint">·</span>
                        <span className="min-w-0 truncate">{t.exit_reason}</span>
                      </>
                    )}
                  </div>
                </div>
                {/* fixed-width right P&L column so every row's % aligns on a common
                    x. -100.00% (8 glyphs) is the sizing worst case; min-w is a floor
                    not a cap → a rare >100% value extends left instead of clipping.
                    The no-P&L pill lives in the SAME column so alignment holds. */}
                <div className="min-w-[5rem] shrink-0 text-right">
                  {t.pnl_pct != null ? (
                    <MoneyText value={t.pnl_pct} unit="%" size="md" showSign />
                  ) : (
                    // B6-RECENT-GAPS / RM-RED-2 M10: closed trade w/ no captured
                    // native P&L → "no P&L" neutral pill (never a misleading 0.00%).
                    <Pill tone="neutral" size="sm" title="Closed — native P&L not captured">
                      no P&L
                    </Pill>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
