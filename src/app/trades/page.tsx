"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  History,
  BookOpen,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { TabBar, type TabDef } from "@/components/ui/tab-bar";
import { DirectionBadge } from "@/components/ui/direction-badge";
import { ConfidenceBar } from "@/components/ui/confidence-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { HistoryTable } from "@/components/trades/history-table";
import { TradeForm } from "@/components/trades/trade-form";
import { JournalTab } from "@/components/trades/journal-tab";

/* ── Types ── */

type ActiveTrade = {
  ticker: string;
  direction: string;
  entry_price: number;
  current_price?: number;
  stop_price?: number;
  target_price?: number;
  leverage?: number;
  pnl_pct?: number;
  raw_pnl_pct?: number;
  leveraged_pnl_pct?: number;
  created_at?: string;
};

type Signal = {
  id?: number;
  ticker: string;
  signal_type: string;
  confidence: number;
  outcome?: string | null;
  created_at?: string;
  timestamp?: string;
  direction?: string;
  timeframe?: string;
  entry_price?: number;
  target_price?: number;
  stop_price?: number;
};

type TabKey = "active" | "scalp" | "lt" | "history" | "journal";

/* ── Tab Definitions ── */

const TABS: TabDef<TabKey>[] = [
  { key: "active", label: "ACTIVE", icon: Activity },
  { key: "scalp", label: "SCALP SIGNALS", icon: TrendingUp },
  { key: "lt", label: "LT SIGNALS", icon: TrendingDown },
  { key: "history", label: "HISTORY", icon: History },
  { key: "journal", label: "JOURNAL", icon: BookOpen },
];

/* ── Signal Type Classification ── */

function isScalpSignal(s: Signal): boolean {
  const t = (s.signal_type || "").toLowerCase();
  const tf = (s.timeframe || "").toLowerCase();
  return (
    t.includes("scalp") ||
    tf === "5m" ||
    tf === "1m" ||
    tf === "15m" ||
    t.includes("perp") ||
    t.includes("momentum_burst") ||
    t.includes("breakout") ||
    // Default: if not clearly LT, treat as scalp
    (!t.includes("long_term") &&
      !t.includes("swing") &&
      !t.includes("position") &&
      !tf.includes("4h") &&
      !tf.includes("1d") &&
      !tf.includes("1w"))
  );
}

/* ── Outcome Icon ── */

function OutcomeIcon({ outcome }: { outcome?: string | null }) {
  if (outcome === "win" || outcome === "WIN")
    return <CheckCircle className="h-3.5 w-3.5 text-[var(--neon-green)]" />;
  if (outcome === "loss" || outcome === "LOSS")
    return <XCircle className="h-3.5 w-3.5 text-[var(--neon-red)]" />;
  return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
}

/* ── Signal Table ── */

function SignalTable({
  signals,
  loading,
  emptyMessage,
}: {
  signals: Signal[];
  loading: boolean;
  emptyMessage: string;
}) {
  if (loading) {
    return (
      <div className="space-y-0">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2 px-2 py-1.5">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 w-8" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    );
  }

  if (signals.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        message={emptyMessage}
        sub="Signals will appear here as the scanner runs"
      />
    );
  }

  return (
    <>
      {/* Table Header */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--border)] text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground bg-[var(--panel-header)]">
        <span className="w-16">Ticker</span>
        <span className="w-12">Dir</span>
        <span className="flex-1">Signal</span>
        <span className="w-14 text-right">Conf</span>
        <span className="w-10 text-center">Result</span>
        <span className="w-20 text-right">Time</span>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-auto">
        {signals.map((s, i) => {
          const time = (s.created_at || s.timestamp)
            ? new Date(s.created_at || s.timestamp || "").toLocaleTimeString(
                "en-US",
                { hour12: false, hour: "2-digit", minute: "2-digit" }
              )
            : "";

          return (
            <div
              key={s.id || i}
              className="flex items-center gap-2 data-cell hover:bg-[rgba(0,240,255,0.03)] transition-colors"
            >
              <span className="w-16 font-bold text-foreground truncate text-[11px]">
                {s.ticker}
              </span>
              <span className="w-12">
                <DirectionBadge dir={s.direction || "long"} />
              </span>
              <span className="flex-1 text-[10px] text-muted-foreground truncate">
                {s.signal_type || "--"}
              </span>
              <span className="w-14 flex justify-end">
                <ConfidenceBar value={s.confidence} />
              </span>
              <span className="w-10 flex justify-center">
                <OutcomeIcon outcome={s.outcome} />
              </span>
              <span className="w-20 text-right text-[10px] text-muted-foreground">
                {time}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── Active Trades Card Layout ── */

function ActiveTradesTab({
  trades,
  loading,
}: {
  trades: ActiveTrade[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="p-2 space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="panel p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-12" />
              <div className="flex-1" />
              <Skeleton className="h-5 w-20" />
            </div>
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 4 }).map((_, j) => (
                <Skeleton key={j} className="h-8 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        message="No active positions"
        sub="Trades will appear here when you TAKE a signal"
      />
    );
  }

  return (
    <div className="p-2 space-y-2">
      {trades.map((t, i) => {
        const pnl = t.leveraged_pnl_pct ?? t.pnl_pct ?? 0;

        return (
          <div key={i} className="panel p-3 glow-border">
            {/* Header Row */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">{t.ticker}</span>
                <DirectionBadge dir={t.direction} />
                {t.leverage != null && t.leverage > 1 && (
                  <span className="text-[10px] font-bold neon-amber">
                    {t.leverage}x
                  </span>
                )}
              </div>
              <span
                className={cn(
                  "text-lg font-bold font-mono",
                  pnl >= 0 ? "neon-green" : "neon-red"
                )}
              >
                {pnl >= 0 ? "+" : ""}
                {pnl.toFixed(2)}%
              </span>
            </div>

            {/* Price Grid */}
            <div className="grid grid-cols-4 gap-2 text-[10px]">
              <div>
                <span className="text-muted-foreground">Entry</span>
                <br />
                <span className="font-mono">
                  ${t.entry_price?.toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Current</span>
                <br />
                <span className="font-mono">
                  {t.current_price != null
                    ? `$${t.current_price.toFixed(2)}`
                    : "-"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">SL</span>
                <br />
                <span className="font-mono neon-red">
                  {t.stop_price != null
                    ? `$${t.stop_price.toFixed(2)}`
                    : "-"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">TP</span>
                <br />
                <span className="font-mono neon-green">
                  {t.target_price != null
                    ? `$${t.target_price.toFixed(2)}`
                    : "-"}
                </span>
              </div>
            </div>

            {/* Timestamp */}
            {t.created_at && (
              <div className="mt-1.5 text-[9px] text-muted-foreground">
                Opened{" "}
                {new Date(t.created_at).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Main Page ── */

export default function TradesPage() {
  const [tab, setTab] = useState<TabKey>("active");
  const [activeTrades, setActiveTrades] = useState<ActiveTrade[]>([]);
  const [allSignals, setAllSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [tradeFormOpen, setTradeFormOpen] = useState(false);

  const fetchActiveAndSignals = useCallback(async () => {
    const [activeData, liveData] = await Promise.all([
      safeFetch<{ trades?: ActiveTrade[] }>("/api/trades?scope=active", {}),
      safeFetch<{ recentSignals?: Signal[] }>("/api/live", {}),
    ]);
    setActiveTrades(activeData.trades || []);
    setAllSignals(liveData.recentSignals || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchActiveAndSignals();
    const interval = setInterval(fetchActiveAndSignals, 15000);
    return () => clearInterval(interval);
  }, [fetchActiveAndSignals]);

  const scalpSignals = allSignals.filter(isScalpSignal);
  const ltSignals = allSignals.filter((s) => !isScalpSignal(s));

  const handleRefresh = () => {
    fetchActiveAndSignals();
  };

  return (
    <div className="flex-1 overflow-auto p-2">
      <div className="panel h-full flex flex-col">
        {/* Tab Bar + Actions */}
        <div className="flex items-center">
          <div className="flex-1">
            <TabBar tabs={TABS} active={tab} onChange={setTab} />
          </div>
          {tab === "history" && (
            <div className="flex items-center gap-1.5 px-2">
              <button
                onClick={() => setTradeFormOpen(true)}
                className="flex items-center gap-1 text-[9px] px-2 py-1 font-bold uppercase tracking-wider bg-[rgba(0,240,255,0.1)] text-[var(--neon-cyan)] border border-[rgba(0,240,255,0.3)] rounded hover:bg-[rgba(0,240,255,0.2)] transition-colors"
              >
                <Plus className="h-3 w-3" />
                Add Trade
              </button>
            </div>
          )}
          {(tab === "active" || tab === "scalp" || tab === "lt") && (
            <div className="px-2">
              <button
                onClick={handleRefresh}
                className="text-muted-foreground hover:text-[var(--neon-cyan)] transition-colors"
                title="Refresh"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </button>
            </div>
          )}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-auto">
          {tab === "active" && (
            <ActiveTradesTab trades={activeTrades} loading={loading} />
          )}

          {tab === "scalp" && (
            <SignalTable
              signals={scalpSignals}
              loading={loading}
              emptyMessage="No scalp signals"
            />
          )}

          {tab === "lt" && (
            <SignalTable
              signals={ltSignals}
              loading={loading}
              emptyMessage="No long-term signals"
            />
          )}

          {tab === "history" && <HistoryTable onRefresh={handleRefresh} />}

          {tab === "journal" && <JournalTab />}
        </div>
      </div>

      {/* Manual Trade Form Modal */}
      <TradeForm
        open={tradeFormOpen}
        onClose={() => setTradeFormOpen(false)}
        onSave={handleRefresh}
      />
    </div>
  );
}
