"use client";

import { PauseCircle } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { HeaderBar } from "@/components/autotrader/HeaderBar";
import { PositionCard } from "@/components/autotrader/PositionCard";
import { ConfigPanel } from "@/components/autotrader/ConfigPanel";
import { AnalyticsSection } from "@/components/autotrader/AnalyticsSection";
import { TradeHistoryTable } from "@/components/autotrader/TradeHistoryTable";
import { useAutoTraderStream } from "@/hooks/useAutoTraderStream";

// Auto Trader page — Parts 1+2 (2026-04-23)
// Single scroll: Header → Open Positions → Config → Analytics → History.
// Real-time positions via /api/auto-trader/stream SSE.

const MUTED = "#8888a0";

export default function AutoTraderPanel() {
  const { positions, summary, state } = useAutoTraderStream();

  const enabled = !!summary?.enabled;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Section 1: Header bar ── */}
      <HeaderBar summary={summary} connection={state} />

      {/* ── Section 2: Open positions ── */}
      <section>
        <div
          className="mb-2 flex items-baseline justify-between px-1 text-[11px] uppercase tracking-[0.12em]"
          style={{
            fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
            color: MUTED,
          }}
        >
          <span>Open Positions</span>
          <span
            className="text-[10px] normal-case tracking-normal"
            style={{ opacity: 0.7 }}
          >
            {positions.length > 0
              ? `${positions.length} live`
              : "— none —"}
          </span>
        </div>

        {positions.length === 0 ? (
          <EmptyState
            icon={PauseCircle}
            message="No open positions"
            sub={
              enabled
                ? "Watching for eligible scalp signals…"
                : "Auto Trader is disabled. Flip the toggle below or use !auto on in Discord."
            }
            className="rounded-lg"
          />
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {positions.map((p) => (
              <PositionCard key={p.id} p={p} />
            ))}
          </div>
        )}
      </section>

      {/* ── Section 3: Config panel ── */}
      <ConfigPanel />

      {/* ── Section 4: Analytics (charts) ── */}
      <AnalyticsSection />

      {/* ── Section 5: Trade history ── */}
      <TradeHistoryTable />
    </div>
  );
}
