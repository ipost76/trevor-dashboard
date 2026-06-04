"use client";
import * as React from "react";
import { Card, MetricTile, Pill, Skeleton, MoneyText, FilterChips } from "@/components/ui";
import { TrendingUp } from "lucide-react";

// RM-PNL P01 (2026-05-29): Auto Capital = REALIZED-only headline.
// The large number is booked (closed-trade) P&L for the selected ET-calendar
// window — an open position contributes $0 until it's closed. Unrealized is
// shown in a flat GREYED line (never green/red) so it can never be mistaken
// for the real number. Equity is the live HL account value, explicitly
// labeled as floating with open positions.

type WindowKey = "today" | "yesterday" | "week" | "month" | "all";

interface RealizedWindows {
  today: number;
  yesterday: number;
  week: number;
  month: number;
  all: number;
}

interface AutoState {
  equity_usd: number;
  realized: RealizedWindows;
  realized_pct: RealizedWindows;
  realized_count: RealizedWindows;
  realized_unknown_count: number;
  open_exposure_usd: number;
  unrealized_usd: number;
  open_count: number;
  // legacy back-compat (still read for the equity figure if equity_usd absent)
  equity?: number;
  trades_total?: number;
  data_available: boolean;
}

const WINDOWS: ReadonlyArray<{ key: WindowKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yest" },
  { key: "week", label: "1W" },
  { key: "month", label: "1M" },
  { key: "all", label: "All" },
];
const LABELS = WINDOWS.map((w) => w.label);
const LABEL_TO_KEY: Record<string, WindowKey> = Object.fromEntries(
  WINDOWS.map((w) => [w.label, w.key]),
) as Record<string, WindowKey>;

const ZERO: RealizedWindows = { today: 0, yesterday: 0, week: 0, month: 0, all: 0 };

export function CapitalHero() {
  const [data, setData] = React.useState<AutoState | null>(null);
  const [loading, setLoading] = React.useState(true);
  // Default window = Today.
  const [windowLabel, setWindowLabel] = React.useState<string>("Today");

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

  const win = LABEL_TO_KEY[windowLabel] ?? "today";
  const realized = data?.realized ?? ZERO;
  const realizedPct = data?.realized_pct ?? ZERO;
  const realizedCount = data?.realized_count ?? ZERO;
  const equity = data?.equity_usd ?? data?.equity ?? 0;
  const unrealized = data?.unrealized_usd ?? 0;
  const openExposure = data?.open_exposure_usd ?? 0;
  const openCount = data?.open_count ?? 0;
  const totalCount = data?.trades_total ?? 0;
  const unknownCount = data?.realized_unknown_count ?? 0;

  const headlinePnl = realized[win];
  const headlinePct = realizedPct[win];
  const headlineCount = realizedCount[win];

  // Flat greyed text for unrealized — deliberately NOT green/red, so it never
  // reads as part of the booked number. Plain muted mono with an explicit sign.
  const unrealStr = `${unrealized > 0 ? "+" : unrealized < 0 ? "−" : ""}$${Math.abs(
    unrealized,
  ).toFixed(2)}`;

  // EQT-D1 (2026-06-04): de-float the account-value headline. `equity` (HL
  // accountValue) = margin + UNREALIZED + spot USDC, so it balloons with open
  // -position paper gains/losses (the "$82 = account value" mislabel). The
  // honest cash basis is accountValue minus the floating unrealized — that's
  // the stable number Ghost reasons about. Float is shown as a labeled sub-line;
  // the raw float-inclusive value is kept as a small footnote (nothing hidden).
  const realizedEquity = equity - unrealized;

  return (
    <Card padding="lg" className="card-elevated space-y-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-sans text-micro uppercase tracking-wider text-fg-muted">
          <TrendingUp size={12} aria-hidden />
          Auto Capital
        </span>
        <Pill
          tone="cyan"
          size="sm"
          className="bg-accent-cyan-soft/10 text-accent-cyan-soft-strong border-accent-cyan-soft/30"
        >
          REALIZED
        </Pill>
      </div>

      {loading && <Skeleton className="h-40 w-full" />}
      {!loading && data && (
        <>
          {/* ── Realized headline (primary) — booked, closed trades only ── */}
          <div className="space-y-2">
            <span className="font-sans text-micro uppercase tracking-wider text-fg-muted">
              Realized P&L · booked
            </span>
            <div className="flex flex-wrap items-baseline gap-3">
              <MoneyText
                value={headlinePnl}
                unit="$"
                size="hero"
                decimals={2}
                showSign
              />
              {equity > 0 && (
                <MoneyText
                  value={headlinePct}
                  unit="%"
                  size="md"
                  decimals={2}
                  showSign
                />
              )}
            </div>
            <span className="font-sans text-micro text-fg-faint">
              {headlineCount} closed {headlineCount === 1 ? "trade" : "trades"} · open
              positions count $0 until closed
            </span>
          </div>

          {/* ── Window selector (segmented; default Today) ── */}
          <FilterChips
            options={LABELS}
            selected={windowLabel}
            onChange={setWindowLabel}
            ariaLabel="Realized P&L time window"
          />

          {/* ── Greyed secondary block: realized acct value + float + deployed ── */}
          <div className="space-y-1.5 border-t border-border-subtle pt-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-h3 font-bold tabular-nums text-fg-primary">
                ${realizedEquity.toFixed(2)}
              </span>
              <span className="font-sans text-micro italic text-fg-muted">
                realized account value · honest cash (excl. floating)
              </span>
            </div>
            <div className="font-mono text-caption tabular-nums text-fg-faint">
              + floating {unrealStr} unrealized ·{" "}
              {openCount > 0 ? `${openCount} open (floating)` : "no open positions"}
            </div>
            <div className="font-mono text-caption tabular-nums text-fg-faint">
              ${openExposure.toFixed(2)} deployed · {openCount}{" "}
              {openCount === 1 ? "position" : "positions"}
            </div>
            <div className="font-mono text-caption tabular-nums text-fg-faint">
              ${equity.toFixed(2)} incl. floating · live HL account value
            </div>
            {unknownCount > 0 && (
              <div className="font-sans text-micro text-fg-faint">
                {unknownCount} closed{" "}
                {unknownCount === 1 ? "trade" : "trades"} with no booked P&L (excluded)
              </div>
            )}
          </div>

          {/* ── Counts (Trades / Open) ── */}
          <div className="grid grid-cols-2 gap-3">
            <MetricTile
              label="Trades"
              value={String(headlineCount)}
              sub={`${windowLabel.toLowerCase()} · ${totalCount.toLocaleString()} total`}
            />
            <MetricTile label="Open" value={String(openCount)} sub="positions" />
          </div>
        </>
      )}
    </Card>
  );
}
