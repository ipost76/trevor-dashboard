"use client";

import { useEffect, useState, useCallback } from "react";
import { fmtDollarPrice, fmtDollar, fmtPctSigned } from "@/lib/format";
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
  Pencil,
  Check,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
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
  margin_usd?: number;
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
    <div className="flex-1 overflow-auto space-y-1 p-1.5">
      {signals.map((s, i) => {
        const dt = s.created_at || s.timestamp || "";
        let ago = "";
        if (dt) {
          const diff = Date.now() - new Date(dt).getTime();
          const mins = Math.floor(diff / 60000);
          if (mins < 60) ago = `${mins}m ago`;
          else if (mins < 1440) ago = `${Math.floor(mins / 60)}h ago`;
          else ago = `${Math.floor(mins / 1440)}d ago`;
        }
        const ep = s.entry_price;
        const dec = ep && ep < 1 ? 4 : 2;

        return (
          <div key={s.id || i} className="panel p-2 hover:border-[rgba(0,240,255,0.2)] transition-colors">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-foreground">{s.ticker}</span>
              <DirectionBadge dir={s.direction || s.signal_type || "long"} />
              <div className="flex-1" />
              <ConfidenceBar value={s.confidence} />
              <span className="text-[9px] text-muted-foreground w-14 text-right">{ago}</span>
            </div>
            {(s.entry_price || s.stop_price || s.target_price) && (
              <div className="flex gap-3 mt-1 text-[9px] text-muted-foreground">
                {ep ? <span>Entry: <span className="text-foreground">${ep.toFixed(dec)}</span></span> : null}
                {s.target_price ? <span>Target: <span className="neon-green">${s.target_price.toFixed(dec)}</span></span> : null}
                {s.stop_price ? <span>Stop: <span className="neon-red">${s.stop_price.toFixed(dec)}</span></span> : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Collapsible Section ── */
function CollapsibleSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen(p => !p)} className="flex items-center gap-1.5 w-full py-1.5 text-left">
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRightIcon className="h-3 w-3 text-muted-foreground" />}
        <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{title}</span>
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}

/* ── Scalp Split View ── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ScalpSplitView({ signals, loading, summary }: { signals: Signal[]; loading: boolean; summary: any }) {
  const wrColor = (wr: number) => wr >= 55 ? "neon-green" : wr < 45 ? "neon-red" : "neon-amber";
  const pfColor = (pf: number) => pf >= 1.5 ? "neon-green" : pf >= 1.0 ? "neon-amber" : "neon-red";

  const sm = summary?.summary;
  const perf = summary?.trade_performance;
  const cal = summary?.quality?.calibration || {};
  const tickerPerf = (summary?.quality?.ticker_performance || []).slice(0, 5);
  const totalSig = sm?.total_signals || 0;
  const longPct = totalSig > 0 ? Math.round((sm?.long_count || 0) / totalSig * 100) : 0;

  const leftPanel = (
    <div className="space-y-3">
      {/* Summary stat cards */}
      <div className="grid grid-cols-2 gap-1.5">
        {[
          { label: "TOTAL SIGNALS", value: String(totalSig), color: "neon-text" },
          { label: "TODAY", value: String(sm?.signals_today || 0), color: (sm?.signals_today || 0) > 0 ? "neon-green" : "text-foreground" },
          { label: "AVG CONFIDENCE", value: `${sm?.avg_confidence || 0}%`, color: (sm?.avg_confidence || 0) >= 55 ? "neon-green" : (sm?.avg_confidence || 0) >= 40 ? "neon-amber" : "neon-red" },
          { label: "LONG / SHORT", value: `${longPct}/${100 - longPct}`, color: "neon-text" },
        ].map(s => (
          <div key={s.label} className="panel p-2 text-center">
            <div className="stat-label mb-0.5">{s.label}</div>
            <div className={cn("text-base font-bold font-mono", s.color)}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Quality Metrics */}
      {perf && perf.total_closed > 0 ? (
        <QualitySection perf={perf} wrColor={wrColor} pfColor={pfColor} />
      ) : (
        <div className="text-[10px] text-muted-foreground text-center py-2">No closed trades yet</div>
      )}

      {/* Confidence Calibration */}
      {Object.keys(cal).length > 0 && (
        <CalibrationSection cal={cal} wrColor={wrColor} />
      )}

      {/* Ticker Performance */}
      {tickerPerf.length > 0 && (
        <TickerPerfSection tickers={tickerPerf} wrColor={wrColor} />
      )}
    </div>
  );

  return (
    <div className="flex-1 overflow-hidden">
      {/* Desktop: side-by-side */}
      <div className="hidden md:grid h-full" style={{ gridTemplateColumns: "45% 55%", gap: 12 }}>
        <div className="overflow-y-auto pr-2 py-1" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(0,255,136,0.2) transparent" }}>
          {leftPanel}
        </div>
        <div className="overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(0,255,136,0.2) transparent" }}>
          <div className="flex items-center gap-2 px-1.5 pb-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Recent Signals</span>
            <span className="px-1.5 py-0 rounded-full text-[8px] font-bold bg-[var(--neon-green)] text-[#06060b]">{signals.length}</span>
          </div>
          <SignalTable signals={signals} loading={loading} emptyMessage="No scalp signals" />
        </div>
      </div>

      {/* Mobile: stacked */}
      <div className="md:hidden overflow-y-auto h-full p-1.5 space-y-2">
        {/* Stats always visible */}
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { label: "TOTAL", value: String(totalSig), color: "neon-text" },
            { label: "TODAY", value: String(sm?.signals_today || 0), color: (sm?.signals_today || 0) > 0 ? "neon-green" : "text-foreground" },
            { label: "AVG CONF", value: `${sm?.avg_confidence || 0}%`, color: (sm?.avg_confidence || 0) >= 55 ? "neon-green" : (sm?.avg_confidence || 0) >= 40 ? "neon-amber" : "neon-red" },
            { label: "L / S", value: `${longPct}/${100 - longPct}`, color: "neon-text" },
          ].map(s => (
            <div key={s.label} className="panel p-2 text-center">
              <div className="stat-label mb-0.5">{s.label}</div>
              <div className={cn("text-sm font-bold font-mono", s.color)}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Collapsible sections */}
        {perf && perf.total_closed > 0 && (
          <CollapsibleSection title="Quality Metrics">
            <QualitySection perf={perf} wrColor={wrColor} pfColor={pfColor} />
          </CollapsibleSection>
        )}
        {Object.keys(cal).length > 0 && (
          <CollapsibleSection title="Confidence Calibration">
            <CalibrationSection cal={cal} wrColor={wrColor} />
          </CollapsibleSection>
        )}
        {tickerPerf.length > 0 && (
          <CollapsibleSection title="Ticker Performance">
            <TickerPerfSection tickers={tickerPerf} wrColor={wrColor} />
          </CollapsibleSection>
        )}

        {/* Signal cards — collapsible on mobile */}
        <CollapsibleSection title={`Recent Signals (${signals.length})`}>
          <SignalTable signals={signals} loading={loading} emptyMessage="No scalp signals" />
        </CollapsibleSection>
      </div>
    </div>
  );
}

/* ── Quality Section ── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function QualitySection({ perf, wrColor, pfColor }: { perf: any; wrColor: (n: number) => string; pfColor: (n: number) => string }) {
  const items = [
    { label: "Win Rate", value: `${perf.win_rate}%`, color: wrColor(perf.win_rate) },
    { label: "Profit Factor", value: perf.profit_factor ?? "\u2014", color: perf.profit_factor != null ? pfColor(perf.profit_factor) : "text-muted-foreground" },
    { label: "Avg Winner", value: `+${perf.avg_winner_pct}%`, color: "neon-green" },
    { label: "Avg Loser", value: `${perf.avg_loser_pct}%`, color: "neon-red" },
    { label: "Best Trade", value: `+${perf.best_trade_pct}%`, color: "neon-green" },
    { label: "Worst Trade", value: `${perf.worst_trade_pct}%`, color: "neon-red" },
    { label: "Streak", value: perf.current_streak > 0 ? `+${perf.current_streak}` : String(perf.current_streak), color: perf.current_streak >= 0 ? "neon-green" : "neon-red" },
  ];
  return (
    <div>
      <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 pl-2 border-l-2 border-[var(--neon-green)]">Quality Metrics</div>
      <div className="space-y-0.5">
        {items.map(it => (
          <div key={it.label} className="flex items-center justify-between px-2 py-0.5 text-[10px]">
            <span className="text-muted-foreground">{it.label}</span>
            <span className={cn("font-bold font-mono", it.color)}>{it.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Calibration Section ── */
function CalibrationSection({ cal, wrColor }: { cal: Record<string, { trades: number; wins: number; winRate: number | null }>; wrColor: (n: number) => string }) {
  return (
    <div>
      <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 pl-2 border-l-2 border-[var(--neon-cyan)]">Confidence Calibration</div>
      <div className="space-y-0.5">
        {Object.entries(cal).map(([bucket, b]) => (
          <div key={bucket} className="flex items-center justify-between px-2 py-0.5 text-[10px]">
            <span className="text-muted-foreground w-12">{bucket}</span>
            <span className={cn("font-bold font-mono", b.winRate != null ? wrColor(b.winRate) : "text-muted-foreground")}>
              {b.winRate != null ? `${b.winRate}% WR` : "\u2014"}
            </span>
            <span className="text-muted-foreground text-[9px]">({b.trades})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Ticker Performance Section ── */
function TickerPerfSection({ tickers, wrColor }: { tickers: Array<{ symbol: string; trades: number; winRate: number; totalPnl: number }>; wrColor: (n: number) => string }) {
  return (
    <div>
      <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 pl-2 border-l-2 border-[var(--neon-amber)]">Ticker Performance</div>
      <div className="space-y-0.5">
        {tickers.map(t => (
          <div key={t.symbol} className="flex items-center gap-2 px-2 py-0.5 text-[10px]">
            <span className="font-bold text-foreground w-16">{t.symbol}</span>
            <span className="text-muted-foreground">{t.trades} sig</span>
            <span className="flex-1" />
            <span className={cn("font-bold font-mono", wrColor(t.winRate))}>{t.winRate}%</span>
            <span className={cn("font-mono text-[9px]", t.totalPnl >= 0 ? "neon-green" : "neon-red")}>
              {t.totalPnl >= 0 ? "+" : ""}{t.totalPnl.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
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

function EditableEntry({ trade: t, onSaved }: { trade: Record<string, unknown>; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(t.entry_price ?? ""));
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<"ok" | "err" | null>(null);

  const save = async () => {
    const p = parseFloat(val);
    if (isNaN(p) || p <= 0) { setVal(String(t.entry_price ?? "")); setEditing(false); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/trades/edit-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trade_id: t.trade_id, entry_price: p }),
      });
      if (res.ok) {
        setFlash("ok");
        setTimeout(() => { setFlash(null); setEditing(false); onSaved(); }, 600);
      } else { setFlash("err"); setTimeout(() => setFlash(null), 1000); setVal(String(t.entry_price ?? "")); }
    } catch { setFlash("err"); setTimeout(() => setFlash(null), 1000); setVal(String(t.entry_price ?? "")); }
    setSaving(false);
  };

  if (editing) {
    return (
      <div>
        <span className="text-muted-foreground">Entry</span><br />
        <input
          autoFocus
          type="text"
          inputMode="decimal"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setVal(String(t.entry_price ?? "")); setEditing(false); } }}
          onBlur={save}
          className={cn(
            "font-mono text-[10px] w-20 px-1 py-0.5 bg-transparent border rounded outline-none",
            flash === "ok" ? "border-[var(--neon-green)]" : flash === "err" ? "border-[var(--neon-red)]" : "border-[var(--neon-cyan)]",
            saving && "opacity-50"
          )}
        />
      </div>
    );
  }

  return (
    <div className="group cursor-pointer" onClick={() => { setVal(String(t.entry_price ?? "")); setEditing(true); }}>
      <span className="text-muted-foreground">Entry</span><br />
      <span className={cn("font-mono", flash === "ok" && "text-[var(--neon-green)]")}>
        {fmtDollarPrice(t.entry_price as number)}
      </span>
      <Pencil className="h-2 w-2 inline ml-0.5 text-muted-foreground opacity-0 group-hover:opacity-50" />
    </div>
  );
}

/* ── Margin Editor ── */
function MarginEditor({ trade: t, onSaved }: { trade: ActiveTrade; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(t.margin_usd ?? ""));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const margin = parseFloat(val);
    if (isNaN(margin) || margin <= 0 || !t.trade_id) return;
    setSaving(true);
    try {
      await fetch("/api/trades", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trade_id: t.trade_id, margin_usd: margin }),
      });
      setEditing(false);
      onSaved();
    } catch { /* silent */ }
    setSaving(false);
  };

  const lev = t.leverage || 1;
  const notional = (t.margin_usd || 0) * lev;

  if (editing) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
        <span className="text-muted-foreground">$</span>
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          className="input-terminal w-20 text-[10px] px-1 py-0.5"
          placeholder="margin"
        />
        <button onClick={save} disabled={saving} className="text-[var(--neon-green)] hover:opacity-80">
          <Check className="h-3 w-3" />
        </button>
        <button onClick={() => setEditing(false)} className="text-muted-foreground hover:opacity-80">
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-[10px] group cursor-pointer" onClick={() => { setVal(String(t.margin_usd ?? "")); setEditing(true); }}>
      {t.margin_usd ? (
        <>
          <span className="text-muted-foreground">\U0001f4b0 {fmtDollar(t.margin_usd)} margin \u2022 {fmtDollar(notional)} notional</span>
          <Pencil className="h-2.5 w-2.5 text-muted-foreground opacity-0 group-hover:opacity-50" />
        </>
      ) : (
        <span className="text-muted-foreground opacity-60">\U0001f4b0 <span className="neon-text text-[9px]">+ Add margin</span></span>
      )}
    </div>
  );
}

function ActiveTradesTab({
  trades,
  loading,
  onRefresh,
}: {
  trades: ActiveTrade[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"close" | "flip" | null>(null);

  // Fetch live prices for open trades
  useEffect(() => {
    if (!trades.length) return;
    const tickers = [...new Set(trades.map((t) => t.ticker?.replace("-PERP", "").replace("/USD", "")))].join(",");
    const fetchPrices = async () => {
      try {
        const res = await fetch(`/api/prices?tickers=${tickers}`);
        const data = await res.json();
        const p: Record<string, number> = {};
        for (const [k, v] of Object.entries(data.prices || {})) {
          p[k] = (v as { price: number }).price;
        }
        setLivePrices(p);
      } catch { /* ignore */ }
    };
    fetchPrices();
    const iv = setInterval(fetchPrices, 30_000);
    return () => clearInterval(iv);
  }, [trades]);
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
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

        // P&L calc — use live price if available
        const tickerKey = t.ticker?.replace("-PERP", "").replace("/USD", "") || "";
        const livePrice = livePrices[tickerKey] || t.current_price;
        let pnl = t.leveraged_pnl_pct ?? t.pnl_pct ?? 0;
        if (livePrice && t.entry_price && t.entry_price > 0) {
          const rawPnl = t.direction?.toUpperCase() === "SHORT"
            ? ((t.entry_price - livePrice) / t.entry_price) * 100
            : ((livePrice - t.entry_price) / t.entry_price) * 100;
          pnl = rawPnl * (t.leverage || 1);
        }

        // Target progress
        const dynTarget = t.dynamic_target || t.profit_target_price || t.target_price;
        let targetPct = 0;
        if (dynTarget && t.entry_price > 0 && dynTarget !== t.entry_price) {
          if (t.direction?.toUpperCase() === "LONG") {
            targetPct = Math.max(0, Math.min(100,
              ((t.entry_price - t.entry_price) === 0 ? 0 :
              ((livePrice ?? t.entry_price) - t.entry_price) / (dynTarget - t.entry_price) * 100)));
          } else {
            targetPct = Math.max(0, Math.min(100,
              (t.entry_price - (livePrice ?? t.entry_price)) / (t.entry_price - dynTarget) * 100));
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
          <div key={tradeId} className={cn("panel p-3 overflow-hidden max-w-full", exitCond && (t.last_exit_severity ?? 0) >= 7 ? "border border-[rgba(255,51,102,0.3)]" : "glow-border")}>
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
                {fmtPctSigned(pnl)}%
              </span>
            </div>

            {/* Price Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
              <EditableEntry trade={t} onSaved={onRefresh} />
              <div>
                <span className="text-muted-foreground">Current</span><br />
                <span className="font-mono">{livePrice ? `$${livePrice.toFixed(livePrice < 1 ? 4 : 2)}` : "-"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">SL</span><br />
                <span className="font-mono neon-red">{t.stop_price != null ? fmtDollarPrice(t.stop_price) : "-"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Target</span><br />
                <span className="font-mono neon-green">{dynTarget ? fmtDollarPrice(dynTarget) : "-"}</span>
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

            {/* Margin Display + Edit */}
            <MarginEditor trade={t} onSaved={onRefresh} />

            {/* Action Buttons */}
            {t.trade_id && !isActive && (
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                <button onClick={() => { resetAction(); setActionId(tradeId); setActionType("close"); }}
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
                      <span className={cn("font-bold font-mono", previewPnl >= 0 ? "neon-green" : "neon-red")}>{fmtPctSigned(previewPnl)}%</span>
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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
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
  const [capital, setCapital] = useState<number | null>(null);
  const [editingCapital, setEditingCapital] = useState(false);
  const [capitalInput, setCapitalInput] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [scalpSummary, setScalpSummary] = useState<any>(null);

  const fetchActiveAndSignals = useCallback(async () => {
    const [activeData, sigData, summaryData] = await Promise.all([
      safeFetch<{ trades?: ActiveTrade[] }>("/api/trades?scope=active", {}),
      safeFetch<{ signals?: Signal[] }>("/api/signals?scope=list&limit=30", {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      safeFetch<any>("/api/signals?scope=summary", null),
    ]);
    setActiveTrades(activeData.trades || []);
    setAllSignals((sigData.signals || []).map(s => ({ ...s, signal_type: s.signal_type || s.direction || "" })));
    if (summaryData) setScalpSummary(summaryData);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchActiveAndSignals();
    safeFetch<{ capital?: number }>("/api/capital", {}).then((d) => {
      if (d.capital !== undefined) setCapital(d.capital);
    });
    const interval = setInterval(fetchActiveAndSignals, 15000);
    return () => clearInterval(interval);
  }, [fetchActiveAndSignals]);

  const saveCapital = async () => {
    const val = parseFloat(capitalInput);
    if (isNaN(val) || val < 0) return;
    try {
      const res = await fetch("/api/capital", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capital: val }),
      });
      const data = await res.json();
      if (data.capital !== undefined) setCapital(data.capital);
    } catch {}
    setEditingCapital(false);
  };

  const scalpSignals = allSignals.filter(isScalpSignal);
  const ltSignals = allSignals.filter((s) => !isScalpSignal(s));

  const handleRefresh = () => {
    fetchActiveAndSignals();
  };

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-2">
      <div className="panel h-full flex flex-col">
        {/* Capital + Tab Bar + Actions */}
        {capital !== null && (
          <div className="flex items-center gap-2 px-3 py-1 border-b border-[var(--border)]">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Capital</span>
            {editingCapital ? (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.01"
                  className="input-terminal w-20 text-[11px] px-1.5 py-0.5"
                  value={capitalInput}
                  onChange={(e) => setCapitalInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveCapital(); if (e.key === "Escape") setEditingCapital(false); }}
                  autoFocus
                />
                <button onClick={saveCapital} className="text-[var(--neon-green)] hover:brightness-125 transition-colors">
                  <Check className="h-3 w-3" />
                </button>
                <button onClick={() => setEditingCapital(false)} className="text-muted-foreground hover:text-[var(--neon-red)] transition-colors">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setCapitalInput(String(capital)); setEditingCapital(true); }}
                className="flex items-center gap-1 text-[11px] text-[var(--neon-green)] hover:brightness-125 transition-colors"
              >
                {fmtDollar(capital)}
                <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
              </button>
            )}
          </div>
        )}
        <div className="flex items-center">
          <div className="flex-1 min-w-0">
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
            <ScalpSplitView
              signals={scalpSignals}
              loading={loading}
              summary={scalpSummary}
            />
          )}

          {tab === "lt" && (
            ltSignals.length > 0 ? (
              <SignalTable
                signals={ltSignals}
                loading={loading}
                emptyMessage="No long-term signals"
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                <span className="text-3xl">&#x1F680;</span>
                <span className="text-sm font-bold tracking-wider">LONG-TERM SIGNALS</span>
                <span className="text-xs font-bold neon-amber">Coming Soon</span>
                <p className="text-[10px] text-center max-w-xs leading-relaxed opacity-70">
                  Multi-day swing signals with 4h/1D timeframe analysis. Targets 3-14 day holds with macro confluence.
                </p>
              </div>
            )
          )}

          {tab === "history" && <HistoryTable onRefresh={handleRefresh} />}

          {tab === "journal" && <JournalTab />}
        </div>
      </div>

      {/* ── Analytics Sections ── */}
      <TradeAnalytics />

      {/* Manual Trade Form Modal */}
      <TradeForm
        open={tradeFormOpen}
        onClose={() => setTradeFormOpen(false)}
        onSave={handleRefresh}
      />
    </div>
  );
}

/* ── Trade Analytics (Duration + Regime) ── */
function TradeAnalytics() {
  const [duration, setDuration] = useState<Record<string, unknown> | null>(null);
  const [regime, setRegime] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    const load = async () => {
      const [d, r] = await Promise.all([
        safeFetch<Record<string, unknown>>("/api/analytics/duration", {}),
        safeFetch<Record<string, unknown>>("/api/analytics/regime-performance", {}),
      ]);
      if (d && Object.keys(d).length > 0) setDuration(d);
      if (r && Object.keys(r).length > 0) setRegime(r);
    };
    load();
  }, []);

  return (
    <div className="mt-2 space-y-2">
      {/* Duration Analysis */}
      {duration && duration.available === true && <DurationSection data={duration} />}

      {/* Regime Performance */}
      {regime && <RegimeSection data={regime} />}
    </div>
  );
}

function fmtHoldTime(mins: number): string {
  if (!mins && mins !== 0) return "—";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DurationSection({ data }: { data: any }) {
  const s = data.summary ?? {};
  const dist = data.distribution ?? {};
  const opt = data.optimal_window ?? {};

  const avgW = Number(s.avg_hold_minutes_winners ?? 0);
  const avgL = Number(s.avg_hold_minutes_losers ?? 0);
  const medW = Number(s.median_hold_minutes_winners ?? 0);
  const medL = Number(s.median_hold_minutes_losers ?? 0);
  const ratio = Number(s.ratio ?? 0);
  const insight = String(s.insight ?? "");

  return (
    <div className="panel p-3 space-y-3">
      <div className="panel-header flex items-center gap-1.5">
        <Clock className="h-3 w-3" />
        <span>HOLD TIME ANALYSIS</span>
      </div>

      {/* Comparison cards */}
      <div className="grid grid-cols-2 gap-2">
        <div className="panel p-2 text-center">
          <div className="text-[8px] text-muted-foreground uppercase mb-1">Avg Hold — Winners</div>
          <div className="text-sm font-bold font-mono neon-green">{fmtHoldTime(avgW)}</div>
          <div className="text-[9px] text-muted-foreground">median: {fmtHoldTime(medW)}</div>
        </div>
        <div className="panel p-2 text-center">
          <div className="text-[8px] text-muted-foreground uppercase mb-1">Avg Hold — Losers</div>
          <div className={cn("text-sm font-bold font-mono", ratio > 1.5 ? "neon-red" : "text-foreground")}>{fmtHoldTime(avgL)}</div>
          <div className="text-[9px] text-muted-foreground">median: {fmtHoldTime(medL)}</div>
        </div>
      </div>

      {/* Duration distribution */}
      <div className="space-y-0.5">
        <div className="text-[8px] text-muted-foreground uppercase mb-1">Distribution by Bucket</div>
        {((dist.winners ?? []) as Array<{ bucket: string; count: number; avg_pnl_pct: number }>).map((w: { bucket: string; count: number; avg_pnl_pct: number }, i: number) => {
          const losers = (dist.losers ?? []) as Array<{ count: number; avg_pnl_pct: number }>;
          const l = losers[i] ?? { count: 0, avg_pnl_pct: 0 };
          const winners = (dist.winners ?? []) as Array<{ count: number }>;
          const maxCount = Math.max(...winners.map((x: { count: number }) => x.count), ...losers.map((x: { count: number }) => x.count), 1);
          return (
            <div key={w.bucket} className="flex items-center gap-2 text-[10px]">
              <span className="w-14 text-muted-foreground font-mono">{w.bucket}</span>
              <div className="flex-1 flex items-center gap-1 h-4">
                <div className="h-3 rounded bg-green-500/40" style={{ width: `${(w.count / maxCount) * 100}%`, minWidth: w.count > 0 ? "4px" : 0 }} />
                <span className="text-[9px] neon-green">{w.count}W</span>
              </div>
              <div className="flex-1 flex items-center gap-1 h-4">
                <div className="h-3 rounded bg-red-500/40" style={{ width: `${(l.count / maxCount) * 100}%`, minWidth: l.count > 0 ? "4px" : 0 }} />
                <span className="text-[9px] neon-red">{l.count}L</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Optimal window */}
      {opt.best_bucket && (
        <div className="text-[10px] text-muted-foreground">
          Optimal: <span className="neon-green font-bold">{String(opt.best_bucket)}</span> — {Number(opt.best_win_rate ?? 0)}% WR, {fmtPctSigned(Number(opt.best_avg_pnl ?? 0))}% avg
        </div>
      )}

      {/* Insight */}
      {insight && (
        <div className="border-l-2 border-amber-500/50 bg-amber-500/5 px-2.5 py-1.5 text-[10px] text-muted-foreground">
          {insight}
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function RegimeSection({ data }: { data: any }) {
  if (!data) return null;

  if (!data.available) {
    return (
      <div className="panel p-3">
        <div className="panel-header flex items-center gap-1.5 mb-2">
          <Activity className="h-3 w-3" />
          <span>REGIME PERFORMANCE</span>
        </div>
        <div className="panel border-[rgba(0,240,255,0.15)] bg-[rgba(0,240,255,0.03)] p-3 text-center space-y-1">
          <p className="text-[11px] text-muted-foreground">Regime data not available.</p>
          <p className="text-[10px] text-muted-foreground/60">
            {String(data.reason ?? "regime_at_entry is not populated for closed trades. This will activate when the engine starts recording regime at trade entry.")}
          </p>
        </div>
      </div>
    );
  }

  return null; // Full regime UI will render when data becomes available
}
