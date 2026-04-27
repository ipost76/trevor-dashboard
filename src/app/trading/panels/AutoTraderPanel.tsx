"use client";

import { HeaderBar } from "@/components/autotrader/HeaderBar";
import { PositionCard } from "@/components/autotrader/PositionCard";
import { ConfigPanel } from "@/components/autotrader/ConfigPanel";
import { AnalyticsSection } from "@/components/autotrader/AnalyticsSection";
import { TradeHistoryTable } from "@/components/autotrader/TradeHistoryTable";
import { ScanningEmptyState } from "@/components/autotrader/ScanningEmptyState";
import { ActivityFeed } from "@/components/autotrader/ActivityFeed";
import { PerTickerCards } from "@/components/autotrader/PerTickerCards";
import { useAutoTraderStream } from "@/hooks/useAutoTraderStream";

// Auto Trader page — Premium Redesign (2026-04-26).
// Section order:
//   1. Header (status pill + equity hero + sparkline + context strip)
//   2. Active — open positions OR scanning empty state with ticker pills
//   3. Activity feed — real-time event stream
//   4. Per-ticker performance — 5 cards with mini-charts
//   5. Analytics — equity curve + (conditional) P&L by exit reason
//   6. Trade history
//   7. Configuration (collapsible, at bottom)

const MUTED = "#8888a0";

export default function AutoTraderPanel() {
  const { positions, summary, state } = useAutoTraderStream();

  const enabled = !!summary?.enabled;
  const isLive = summary?.mode === "live";

  return (
    <div className="flex flex-col gap-4">
      {/* ── Section 1: Header ── */}
      <HeaderBar summary={summary} connection={state} />

      {/* ── Section 2: Active (positions OR scanning empty state) ── */}
      <section>
        <div
          className="mb-2 flex items-baseline justify-between px-1 text-[11px] uppercase tracking-[0.12em]"
          style={{
            fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
            color: MUTED,
          }}
        >
          <span>{positions.length > 0 ? "Open Positions" : "Scanning"}</span>
          <span
            className="text-[10px] normal-case tracking-normal"
            style={{ opacity: 0.7 }}
          >
            {positions.length > 0
              ? `${positions.length} live`
              : "no open positions"}
          </span>
        </div>

        {positions.length === 0 ? (
          <ScanningEmptyState enabled={enabled} />
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {positions.map((p) => (
              <PositionCard key={p.id} p={p} />
            ))}
          </div>
        )}
      </section>

      {/* ── Section 3: Real-time activity feed ── */}
      <ActivityFeed />

      {/* ── Section 4: Per-ticker performance ── */}
      <PerTickerCards defaultMode={isLive ? "live" : "paper"} />

      {/* ── Section 5: Analytics (equity curve + conditional exit reason) ── */}
      <AnalyticsSection summary={summary} />

      {/* ── Section 6: Trade history ── */}
      <TradeHistoryTable summary={summary} />

      {/* ── Section 7: Configuration (collapsible, at bottom) ── */}
      <ConfigPanel summary={summary} />
    </div>
  );
}
