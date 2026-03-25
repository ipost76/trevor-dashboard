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
  X,
  ArrowRightLeft,
  Shield,
  Target,
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
  trade_id?: string;
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
  opened_at?: string;
  track?: string;
  // Exit engine fields
  dynamic_target?: number;
  target_pct?: number;
  peak_pnl_lev?: number;
  last_exit_condition?: string;
  last_exit_severity?: number;
  regime_at_entry?: string;
  confidence?: number;
  profit_target_price?: number;
  atr_at_entry?: number;
  entry_groups?: string;
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

/* ── Exit condition labels ── */
const EXIT_COND: Record<string, { emoji: string; label: string }> = {
  DIRECTION_FLIP: { emoji: "\uD83D\uDD34", label: "Direction Flip" },
  PROFIT_TARGET: { emoji: "\uD83C\uDFAF", label: "Target Zone" },
  PROFIT_FADING: { emoji: "\uD83D\uDCC9", label: "Profit Fading" },
  MOMENTUM_EXHAUSTION: { emoji: "\uD83D\uDCA8", label: "Momentum Dying" },
  PATTERN_MATCH: { emoji: "\uD83D\uDCCA", label: "Pattern Exit" },
  DEGRADATION: { emoji: "\u26A0\uFE0F", label: "Signal Weakening" },
};

function ActiveTradesTab({
  trades,
  loading,
  onRefresh,
}: {
  trades: ActiveTrade[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"close" | "flip" | null>(null);
  const [exitPriceStr, setExitPriceStr] = useState("");
  const [newEntryStr, setNewEntryStr] = useState("");
  const [newLevStr, setNewLevStr] = useState("");
  const [closeStatus, setCloseStatus] = useState<
    "idle" | "submitting" | "polling" | "done" | "error"
  >("idle");
  const [closeError, setCloseError] = useState("");

  const resetAction = () => {
    setActionId(null);
    setActionType(null);
    setExitPriceStr("");
    setNewEntryStr("");
    setNewLevStr("");
    setCloseStatus("idle");
    setCloseError("");
  };

  const pollForCompletion = (tradeId: string, endpoint: string) => {
    setCloseStatus("polling");
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch(`${endpoint}?trade_id=${encodeURIComponent(tradeId)}`);
        const data = await res.json();
        if (data.status === "completed") {
          clearInterval(poll);
          setCloseStatus("done");
          setTimeout(() => { resetAction(); onRefresh(); }, 1500);
        } else if (data.status === "failed") {
          clearInterval(poll);
          setCloseStatus("error");
          setCloseError(data.result?.error || "Request failed");
        } else if (attempts > 30) {
          clearInterval(poll);
          setCloseStatus("error");
          setCloseError("Timeout");
        }
      } catch { /* continue */ }
    }, 2000);
  };

  const handleClose = async (tradeId: string) => {
    const price = parseFloat(exitPriceStr);
    if (!price || price <= 0) return;
    setCloseStatus("submitting");
    setCloseError("");
    try {
      const res = await fetch("/api/trades/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trade_id: tradeId, exit_price: price }),
      });
      const data = await res.json();
      if (data.error) { setCloseStatus("error"); setCloseError(data.error); return; }
      pollForCompletion(tradeId, "/api/trades/close-status");
    } catch (err) { setCloseStatus("error"); setCloseError(String(err)); }
  };

  const handleHold = async (tradeId: string) => {
    try {
      await fetch("/api/trades/hold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trade_id: tradeId }),
      });
      onRefresh();
    } catch { /* silent */ }
  };

  const handleFlip = async (tradeId: string) => {
    const exit = parseFloat(exitPriceStr);
    const entry = parseFloat(newEntryStr);
    const lev = parseInt(newLevStr) || 1;
    if (!exit || !entry) return;
    setCloseStatus("submitting");
    setCloseError("");
    try {
      const res = await fetch("/api/trades/flip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trade_id: tradeId, exit_price: exit, new_entry: entry, leverage: lev }),
      });
      const data = await res.json();
      if (data.error) { setCloseStatus("error"); setCloseError(data.error); return; }
      pollForCompletion(tradeId, "/api/trades/command-status");
    } catch (err) { setCloseStatus("error"); setCloseError(String(err)); }
  };

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
        const tradeId = t.trade_id || `${t.ticker}_${i}`;
        const isActive = actionId === tradeId;
        const dirMult = t.direction?.toUpperCase() === "SHORT" ? -1 : 1;

        // P&L calc
        const pnl = t.leveraged_pnl_pct ?? t.pnl_pct ?? 0;

        // Target progress
        const dynTarget = t.dynamic_target || t.profit_target_price || t.target_price;
        let targetPct = 0;
        if (dynTarget && t.entry_price > 0 && dynTarget !== t.entry_price) {
          if (t.direction?.toUpperCase() === "LONG") {
            targetPct = Math.max(0, Math.min(100,
              ((t.entry_price - t.entry_price) === 0 ? 0 :
              ((t.current_price ?? t.entry_price) - t.entry_price) / (dynTarget - t.entry_price) * 100)));
          } else {
            targetPct = Math.max(0, Math.min(100,
              (t.entry_price - (t.current_price ?? t.entry_price)) / (t.entry_price - dynTarget) * 100));
          }
        }

        // Exit condition
        const exitCond = t.last_exit_condition ? EXIT_COND[t.last_exit_condition] : null;
        const openedAt = t.opened_at || t.created_at;

        // Preview for close/flip
        const exitPrice = parseFloat(exitPriceStr);
        const hasValidExit = !isNaN(exitPrice) && exitPrice > 0;
        const previewPnl = hasValidExit && t.entry_price > 0
          ? ((exitPrice - t.entry_price) / t.entry_price) * dirMult * (t.leverage || 1) * 100
          : null;

        return (
          <div key={tradeId} className={cn("panel p-3", exitCond && (t.last_exit_severity ?? 0) >= 7 ? "border border-[rgba(255,51,102,0.3)]" : "glow-border")}>
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">{t.ticker}</span>
                <DirectionBadge dir={t.direction} />
                {(t.leverage ?? 1) > 1 && (
                  <span className="text-[10px] font-bold neon-amber">{t.leverage}x</span>
                )}
                {t.regime_at_entry && (
                  <span className="text-[9px] px-1 rounded border border-[var(--border)] text-muted-foreground">{t.regime_at_entry}</span>
                )}
              </div>
              <span className={cn("text-lg font-bold font-mono", pnl >= 0 ? "neon-green" : "neon-red")}>
                {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
              </span>
            </div>

            {/* Price Grid */}
            <div className="grid grid-cols-4 gap-2 text-[10px]">
              <div>
                <span className="text-muted-foreground">Entry</span><br />
                <span className="font-mono">${t.entry_price?.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Current</span><br />
                <span className="font-mono">{t.current_price != null ? `$${t.current_price.toFixed(2)}` : "-"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">SL</span><br />
                <span className="font-mono neon-red">{t.stop_price != null ? `$${t.stop_price.toFixed(2)}` : "-"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Target</span><br />
                <span className="font-mono neon-green">{dynTarget ? `$${dynTarget.toFixed(2)}` : "-"}</span>
              </div>
            </div>

            {/* Target Progress + Peak P&L */}
            {dynTarget && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-[9px] text-muted-foreground mb-0.5">
                  <span>{targetPct.toFixed(0)}% to target</span>
                  {(t.peak_pnl_lev ?? 0) > 0 && (
                    <span>Peak: +{(t.peak_pnl_lev ?? 0).toFixed(1)}%</span>
                  )}
                </div>
                <div className="w-full h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", pnl >= 0 ? "bg-[var(--neon-green)]" : "bg-[var(--neon-red)]")}
                    style={{ width: `${Math.max(0, Math.min(100, targetPct))}%` }}
                  />
                </div>
              </div>
            )}

            {/* Exit Condition Badge */}
            {exitCond && (
              <div className={cn(
                "mt-2 p-1.5 rounded text-[10px] border",
                (t.last_exit_severity ?? 0) >= 7
                  ? "border-[rgba(255,51,102,0.3)] bg-[rgba(255,51,102,0.06)]"
                  : "border-[rgba(255,165,2,0.3)] bg-[rgba(255,165,2,0.04)]"
              )}>
                <span className="font-bold">{exitCond.emoji} {exitCond.label}</span>
                {t.last_exit_severity != null && (
                  <span className="text-muted-foreground ml-1">(sev {t.last_exit_severity})</span>
                )}
              </div>
            )}

            {/* Timestamp */}
            {openedAt && (
              <div className="mt-1.5 text-[9px] text-muted-foreground">
                Opened {new Date(openedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}
              </div>
            )}

            {/* Action Buttons */}
            {t.trade_id && !isActive && (
              <div className="mt-2 flex items-center gap-1.5">
                <button onClick={() => { setActionId(tradeId); setActionType("close"); resetAction(); setActionId(tradeId); setActionType("close"); }}
                  className="flex items-center gap-1 text-[9px] px-2 py-1 font-bold uppercase tracking-wider bg-[rgba(255,51,102,0.1)] text-[var(--neon-red)] border border-[rgba(255,51,102,0.3)] rounded hover:bg-[rgba(255,51,102,0.2)] transition-colors">
                  <X className="h-3 w-3" /> Close
                </button>
                <button onClick={() => handleHold(tradeId)}
                  className="flex items-center gap-1 text-[9px] px-2 py-1 font-bold uppercase tracking-wider bg-[rgba(0,240,255,0.1)] text-[var(--neon-cyan)] border border-[rgba(0,240,255,0.3)] rounded hover:bg-[rgba(0,240,255,0.2)] transition-colors">
                  <Shield className="h-3 w-3" /> Hold
                </button>
                <button onClick={() => { resetAction(); setActionId(tradeId); setActionType("flip"); }}
                  className="flex items-center gap-1 text-[9px] px-2 py-1 font-bold uppercase tracking-wider bg-[rgba(255,165,2,0.1)] text-[var(--neon-amber)] border border-[rgba(255,165,2,0.3)] rounded hover:bg-[rgba(255,165,2,0.2)] transition-colors">
                  <ArrowRightLeft className="h-3 w-3" /> Flip
                </button>
              </div>
            )}

            {/* ── Close Panel ── */}
            {isActive && actionType === "close" && (
              <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Close Position</span>
                  <button onClick={resetAction} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                </div>
                <div className="flex items-center gap-2">
                  <input value={exitPriceStr} onChange={(e) => setExitPriceStr(e.target.value)} placeholder="Exit price" type="number" step="any" min="0" className="input-terminal flex-1" autoFocus disabled={closeStatus !== "idle"} onKeyDown={(e) => { if (e.key === "Enter" && hasValidExit) handleClose(tradeId); }} />
                  <button onClick={() => handleClose(tradeId)} disabled={!hasValidExit || closeStatus !== "idle"} className={cn("btn-primary whitespace-nowrap", (!hasValidExit || closeStatus !== "idle") && "opacity-50 pointer-events-none")}>
                    {closeStatus === "idle" ? "Close" : closeStatus === "submitting" ? "Sending..." : closeStatus === "polling" ? "Processing..." : closeStatus === "done" ? "Done!" : "Retry"}
                  </button>
                </div>
                {previewPnl !== null && (
                  <div className={cn("panel p-2 border text-[10px]", previewPnl >= 0 ? "border-[rgba(0,255,136,0.3)] bg-[rgba(0,255,136,0.04)]" : "border-[rgba(255,51,102,0.3)] bg-[rgba(255,51,102,0.04)]")}>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Est. P&L</span>
                      <span className={cn("font-bold font-mono", previewPnl >= 0 ? "neon-green" : "neon-red")}>{previewPnl >= 0 ? "+" : ""}{previewPnl.toFixed(2)}%</span>
                    </div>
                  </div>
                )}
                {closeStatus === "error" && closeError && <div className="text-[10px] neon-red">{closeError}</div>}
                {closeStatus === "done" && <div className="text-[10px] neon-green font-bold">Closed. Results posted to Discord.</div>}
              </div>
            )}

            {/* ── Flip Panel ── */}
            {isActive && actionType === "flip" && (
              <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Flip to {t.direction?.toUpperCase() === "LONG" ? "SHORT" : "LONG"}
                  </span>
                  <button onClick={resetAction} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input value={exitPriceStr} onChange={(e) => setExitPriceStr(e.target.value)} placeholder="Exit price" type="number" step="any" className="input-terminal" autoFocus />
                  <input value={newEntryStr} onChange={(e) => setNewEntryStr(e.target.value)} placeholder="New entry" type="number" step="any" className="input-terminal" />
                  <input value={newLevStr} onChange={(e) => setNewLevStr(e.target.value)} placeholder={`${t.leverage || 1}x`} type="number" min="1" max="125" className="input-terminal" />
                </div>
                <button onClick={() => handleFlip(tradeId)} disabled={!hasValidExit || !parseFloat(newEntryStr) || closeStatus !== "idle"} className={cn("btn-primary w-full", closeStatus !== "idle" && "opacity-50 pointer-events-none")}>
                  {closeStatus === "idle" ? `Close ${t.direction} + Open ${t.direction?.toUpperCase() === "LONG" ? "SHORT" : "LONG"}` : closeStatus === "submitting" ? "Sending..." : closeStatus === "polling" ? "Processing..." : closeStatus === "done" ? "Done!" : "Retry"}
                </button>
                {closeStatus === "error" && closeError && <div className="text-[10px] neon-red">{closeError}</div>}
                {closeStatus === "done" && <div className="text-[10px] neon-green font-bold">Flipped. New trade posted to Discord.</div>}
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
            <ActiveTradesTab trades={activeTrades} loading={loading} onRefresh={handleRefresh} />
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
