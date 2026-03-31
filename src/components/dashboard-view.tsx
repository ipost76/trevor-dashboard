"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  TrendingUp, Activity, Zap, Clock,
  Send, Wifi, WifiOff, Target, Bot,
  AlertTriangle, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { fmtDollarPrice, fmtPctSigned, fmtPrice } from "@/lib/format";
import Link from "next/link";
import { DirectionBadge } from "@/components/ui/direction-badge";
import { ConfidenceBar } from "@/components/ui/confidence-bar";
import { StatStripSkeleton, PanelSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

/* ── Types (unchanged) ── */
type Signal = {
  ticker: string; direction?: string; confidence: number;
  signal_type?: string; outcome?: string; timestamp?: string; created_at?: string;
};
type ActiveTrade = {
  ticker: string; direction: string; entry_price: number;
  current_price?: number; pnl_pct?: number; leverage?: number;
  leveraged_pnl_pct?: number;
};
type ChatMsg = { role: "user" | "assistant"; content: string; timestamp?: string };
type CalBucket = { trades: number; wins: number; winRate: number | null };

type AutoPosition = {
  ticker: string; side: string; entry_price: number; qty: number;
  stop_price?: number; target_price?: number; entry_time: string; signal_score?: number;
};
type AutoSignal = {
  ticker: string; direction: string; tier3_score?: number;
  action: string; created_at: string;
};
type AutoData = {
  status: string;
  positions: AutoPosition[];
  recentTrades: Array<Record<string, unknown>>;
  recentSignals: AutoSignal[];
  stats: { total: number; wins: number; losses: number; winRate: number; profitFactor: number; totalPnl: number; avgPnlPct?: number };
  dailyPnl: number;
  budget: { spent: number; remaining: number; calls: number; exceeded: boolean };
};

type DashboardData = {
  xp: number; rank: string; totalInsights: number; todayCost: number;
  recentSignals: Signal[]; activeTrades: ActiveTrade[];
  logTail: string[];
  winRate: number; totalTrades: number; profitFactor: number | null;
  avgPnl: number; totalPnl: number; wins: number; losses: number;
  avgWin: number; avgLoss: number; rrRatio: number; expectancy: number;
  bestTrade: number; worstTrade: number;
  calibration: Record<string, CalBucket>;
  chatMessages: ChatMsg[]; chatHealth: boolean;
  auto: AutoData | null;
};

const EMPTY: DashboardData = {
  xp: 0, rank: "Unknown", totalInsights: 0, todayCost: 0,
  recentSignals: [], activeTrades: [], logTail: [],
  winRate: 0, totalTrades: 0, profitFactor: null, avgPnl: 0,
  totalPnl: 0, wins: 0, losses: 0,
  avgWin: 0, avgLoss: 0, rrRatio: 0, expectancy: 0,
  bestTrade: 0, worstTrade: 0,
  calibration: {},
  chatMessages: [], chatHealth: false,
  auto: null,
};

function timeAgo(ts: string): string {
  if (!ts) return "";
  const d = new Date(ts.endsWith("Z") ? ts : ts.includes("+") ? ts : ts + "Z");
  if (isNaN(d.getTime())) return "";
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

function formatET(ts: string): string {
  if (!ts) return "";
  const d = new Date(ts.endsWith("Z") ? ts : ts.includes("+") ? ts : ts + "Z");
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" });
}

type KillSwitchState = { active: boolean; activated_at?: string; reason?: string };
type SystemHealth = {
  scanner?: { status: string; last_signal_at: string | null };
  signals?: { today: number; seven_day_avg: number; change_pct: number };
  api?: { hyperliquid: { healthy: boolean; latency_ms: number } };
  kill_switch?: { active: boolean };
  autotrader_paused?: { active: boolean; reason?: string };
  circuit_breakers?: Array<{ ticker: string; status: string; win_rate: number; trades: number }>;
};

/* ── Main Component ── */
export function DashboardView() {
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [killSwitch, setKillSwitch] = useState<KillSwitchState>({ active: false });
  const [health, setHealth] = useState<SystemHealth>({});
  const [ksConfirm, setKsConfirm] = useState<"activate" | "deactivate" | null>(null);
  const [ksLoading, setKsLoading] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fetchDashboard = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [live, sq, chat, auto] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      safeFetch<any>("/api/live", null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      safeFetch<any>("/api/signal-quality", null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      safeFetch<any>("/api/chat?action=history&limit=5", null),
      safeFetch<AutoData | null>("/api/autotrader", null),
    ]);
    setData({
      xp: live?.xp ?? 0,
      rank: live?.rank ?? "Unknown",
      totalInsights: live?.signals?.total ?? live?.totalInsights ?? 0,
      todayCost: live?.todayCost ?? live?.cost_today ?? 0,
      recentSignals: live?.recentSignals ?? [],
      activeTrades: live?.activeTrades ?? live?.activeScalps ?? [],
      logTail: live?.logTail ?? live?.logs ?? [],
      winRate: sq?.overall?.winRate ?? 0,
      totalTrades: sq?.overall?.totalTrades ?? 0,
      profitFactor: sq?.overall?.profitFactor ?? null,
      avgPnl: sq?.overall?.avgPnl ?? 0,
      totalPnl: sq?.overall?.totalPnl ?? 0,
      wins: sq?.overall?.wins ?? 0,
      losses: sq?.overall?.losses ?? 0,
      avgWin: sq?.overall?.avgWin ?? 0,
      avgLoss: sq?.overall?.avgLoss ?? 0,
      rrRatio: sq?.overall?.rrRatio ?? 0,
      expectancy: sq?.overall?.expectancy ?? 0,
      bestTrade: sq?.overall?.bestTrade ?? 0,
      worstTrade: sq?.overall?.worstTrade ?? 0,
      calibration: sq?.calibration ?? {},
      chatMessages: chat?.messages ?? [],
      chatHealth: chat?.ok !== false,
      auto: auto ?? null,
    });
    setLoading(false);
  }, []);

  useEffect(() => { fetchDashboard(); const i = setInterval(fetchDashboard, 30000); return () => clearInterval(i); }, [fetchDashboard]);

  useEffect(() => {
    const fetchKs = async () => {
      const [ks, sh] = await Promise.all([
        safeFetch<KillSwitchState>("/api/kill-switch", { active: false }),
        safeFetch<SystemHealth>("/api/system-health", {}),
      ]);
      if (ks) setKillSwitch(ks);
      if (sh) setHealth(sh);
    };
    fetchKs();
    const iv = setInterval(fetchKs, 10000);
    return () => clearInterval(iv);
  }, []);

  const toggleKillSwitch = async () => {
    setKsLoading(true);
    try {
      const action = killSwitch.active ? "deactivate" : "activate";
      const res = await fetch("/api/kill-switch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: `${action === "activate" ? "Emergency stop" : "Resumed"} via Hub` }),
      });
      const d = await res.json();
      setKillSwitch({ active: d.active });
    } catch { /* ignore */ }
    setKsLoading(false);
    setKsConfirm(null);
  };

  useEffect(() => {
    if (!data.activeTrades.length) return;
    const tickers = [...new Set(data.activeTrades.map(t => t.ticker?.replace("-PERP", "").replace("/USD", "")))].filter(Boolean).join(",");
    if (!tickers) return;
    const fp = async () => {
      try {
        const res = await fetch(`/api/prices?tickers=${tickers}`);
        const d = await res.json();
        const p: Record<string, number> = {};
        for (const [k, v] of Object.entries(d.prices || {})) p[k] = (v as { price: number }).price;
        setLivePrices(p);
      } catch { /* ignore */ }
    };
    fp(); const iv = setInterval(fp, 30000); return () => clearInterval(iv);
  }, [data.activeTrades]);

  const sendChat = useCallback(async () => {
    const msg = chatInput.trim();
    if (!msg || chatSending) return;
    setChatInput("");
    setChatSending(true);
    setData(prev => ({ ...prev, chatMessages: [...prev.chatMessages, { role: "user", content: msg, timestamp: new Date().toISOString() }] }));
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: msg }) });
      const d = await res.json();
      setData(prev => ({ ...prev, chatMessages: [...prev.chatMessages, { role: "assistant", content: d.response || d.error || "No response", timestamp: new Date().toISOString() }] }));
    } catch {
      setData(prev => ({ ...prev, chatMessages: [...prev.chatMessages, { role: "assistant", content: "[Connection error]", timestamp: new Date().toISOString() }] }));
    }
    setChatSending(false);
  }, [chatInput, chatSending]);

  if (loading) {
    return (
      <div className="flex-1 overflow-hidden p-2 flex flex-col gap-2">
        <StatStripSkeleton />
        <div className="grid grid-cols-1 gap-2 flex-1">
          <PanelSkeleton title="LOADING..." />
        </div>
      </div>
    );
  }

  const decided = data.wins + data.losses;
  const winPct = decided > 0 ? ((data.wins / decided) * 100).toFixed(1) : "0";
  const wrColor = Number(winPct) >= 55 ? "neon-green" : Number(winPct) >= 40 ? "neon-amber" : "neon-red";
  const atStats = data.auto?.stats;
  const atEquity = (data.auto as Record<string, unknown>)?.account
    ? ((data.auto as Record<string, unknown>).account as Record<string, number>)?.equity ?? 0
    : 0;

  return (
    <div className="flex-1 overflow-y-auto p-3 pb-16 md:pb-3 space-y-3">

      {/* ── Kill Switch Confirmation Dialog ── */}
      {ksConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="panel p-4 max-w-sm w-full mx-4 space-y-3">
            <div className="text-sm font-bold text-foreground">
              {ksConfirm === "activate" ? "HALT ALL SYSTEMS?" : "RESUME ALL SYSTEMS?"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {ksConfirm === "activate"
                ? "This will halt ALL signal generation and AutoTrader execution."
                : "Resume all signal generation and AutoTrader execution?"}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setKsConfirm(null)} className="px-3 py-1.5 text-[11px] rounded border border-[var(--border)] text-muted-foreground hover:text-foreground">Cancel</button>
              <button onClick={toggleKillSwitch} disabled={ksLoading}
                className={cn("px-3 py-1.5 text-[11px] rounded font-bold", ksConfirm === "activate" ? "bg-red-600 text-white" : "bg-green-600 text-white")}>
                {ksLoading ? "..." : ksConfirm === "activate" ? "CONFIRM HALT" : "CONFIRM RESUME"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── System Status Bar (compact) ── */}
      <div className={cn("panel px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]",
        killSwitch.active && "border-red-500/50 bg-red-500/5")}>
        {/* Kill switch state */}
        {killSwitch.active ? (
          <button onClick={() => setKsConfirm("deactivate")} className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-red-500/15 border border-red-500/30 text-[var(--neon-red)] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--neon-red)]" />HALTED
          </button>
        ) : (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--neon-green)] shadow-[0_0_4px_var(--neon-green)] animate-[pulseLive_2s_ease-in-out_infinite]" />
            <span className="neon-green font-bold">LIVE</span>
          </span>
        )}
        <span className="text-muted-foreground">
          Scanner: {health.scanner?.status === "running" ? <span className="neon-green">OK</span> : <span className="neon-red">?</span>}
        </span>
        <span className="text-muted-foreground">
          API: {health.api?.hyperliquid?.healthy ? <span className="neon-green">{health.api.hyperliquid.latency_ms}ms</span> : <span className="neon-red">DOWN</span>}
        </span>
        <span className="text-muted-foreground">
          Today: <span className="text-foreground font-mono">{health.signals?.today ?? 0} signals</span>
        </span>
        {health.autotrader_paused?.active && (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 border border-amber-500/30 neon-amber">AT: PAUSED</span>
        )}
        {!killSwitch.active && (
          <button onClick={() => setKsConfirm("activate")} className="ml-auto text-[10px] font-semibold uppercase tracking-wide px-2.5 py-0.5 rounded-md bg-transparent border border-[rgba(255,68,68,0.25)] text-[rgba(255,68,68,0.7)] hover:bg-[rgba(255,68,68,0.1)] hover:text-[#ff4444] hover:border-[rgba(255,68,68,0.5)] transition-all">
            STOP
          </button>
        )}
      </div>

      {/* ── Portfolio Stats (2×2 grid) ── */}
      <div className="grid grid-cols-2 gap-px bg-[rgba(255,255,255,0.04)] rounded-lg overflow-hidden">
        <StatCell label="P&L" value={`${fmtPctSigned(data.totalPnl)}%`} color={data.totalPnl >= 0 ? "neon-green" : "neon-red"} />
        <StatCell label="W / L" value={`${data.wins}W · ${data.losses}L`} sub={`${winPct}% WR`} />
        <StatCell label="Win Rate" value={`${winPct}%`} color={wrColor} />
        <StatCell label="Active" value={String(data.activeTrades.length)} color={data.activeTrades.length > 0 ? "neon-green" : "text-muted-foreground"} />
      </div>

      {/* ── Secondary Stats (3-col) ── */}
      <div className="grid grid-cols-3 gap-px bg-[rgba(255,255,255,0.04)] rounded-lg overflow-hidden">
        <StatCell label="XP" value={String(data.xp)} sub={data.rank} color="neon-green" size="sm" />
        <StatCell label="Signals" value={String(data.totalInsights)} size="sm" />
        <StatCell label="Avg P&L" value={`${fmtPctSigned(data.avgPnl)}%`} color={data.avgPnl >= 0 ? "neon-green" : "neon-red"} size="sm" />
      </div>

      {/* ── Edge Analysis Card ── */}
      {data.totalTrades > 0 && (
        <div className="panel overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.3),0_0_1px_rgba(255,255,255,0.05)] rounded-[10px]">
          <div className="px-3 py-1.5 border-b border-[var(--border)] bg-[var(--panel-header)]">
            <span className="text-[9px] font-bold tracking-[0.1em] uppercase text-muted-foreground">Edge Analysis</span>
          </div>
          <div className="px-3 py-2.5 space-y-2">
            {/* R:R + Expectancy row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">R:R Ratio</div>
                <div className={cn("text-lg font-bold font-mono", data.rrRatio >= 1.5 ? "neon-green" : data.rrRatio >= 1 ? "neon-amber" : "neon-red")}>
                  {data.rrRatio.toFixed(2)}R
                </div>
                <div className="text-[9px] text-muted-foreground font-mono">
                  Win: <span className="neon-green">+{data.avgWin}%</span> · Loss: <span className="neon-red">{data.avgLoss}%</span>
                </div>
              </div>
              <div>
                <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">Expectancy</div>
                <div className={cn("text-lg font-bold font-mono", data.expectancy > 0 ? "neon-green" : data.expectancy > -0.5 ? "neon-amber" : "neon-red")}>
                  {fmtPctSigned(data.expectancy)}%
                </div>
                <div className={cn("text-[9px]", data.expectancy >= 0 ? "neon-green" : "neon-amber")}>
                  {data.expectancy < 0 && data.rrRatio < 1
                    ? "Fix: WR and R:R both underwater"
                    : data.expectancy < 0
                    ? `Need WR > ${(1 / (1 + data.rrRatio) * 100).toFixed(0)}%`
                    : "Edge positive"}
                </div>
              </div>
            </div>
            {/* Best / Worst */}
            <div className="flex items-center justify-between pt-2 border-t border-[var(--border)] text-[10px] font-mono">
              <span>Best: <span className="neon-green">+{data.bestTrade}%</span></span>
              <span>Worst: <span className="neon-red">{data.worstTrade}%</span></span>
              {Math.abs(data.worstTrade) > data.bestTrade && (
                <span className="text-[9px] text-muted-foreground">asymmetric ↓</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Active Trades ── */}
      <Link href="/trades" className={cn("panel flex flex-col overflow-hidden hover:border-[rgba(0,240,255,0.25)] transition-all rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.3)]", data.activeTrades.length > 0 && "border-[rgba(0,255,136,0.15)] shadow-[0_2px_8px_rgba(0,0,0,0.3),0_0_20px_rgba(0,255,136,0.04)]")}>
        <div className="panel-header flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Activity className="h-3 w-3" />
            <span>ACTIVE TRADES</span>
            {data.activeTrades.length > 0 && (
              <span className="ml-1 px-1.5 py-0 rounded-full text-[8px] font-bold bg-[var(--neon-green)] text-[#06060b]">{data.activeTrades.length}</span>
            )}
          </div>
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        </div>
        <div className="p-2">
          {data.activeTrades.length > 0 ? (
            <div className="space-y-1.5">
              {data.activeTrades.slice(0, 4).map((t, i) => {
                const tk = t.ticker?.replace("-PERP", "").replace("/USD", "") || "";
                const lp = livePrices[tk] || t.current_price;
                let pnl = t.leveraged_pnl_pct ?? t.pnl_pct ?? 0;
                if (lp && t.entry_price && t.entry_price > 0) {
                  const raw = t.direction?.toUpperCase() === "SHORT"
                    ? ((t.entry_price - lp) / t.entry_price) * 100
                    : ((lp - t.entry_price) / t.entry_price) * 100;
                  pnl = raw * (t.leverage || 1);
                }
                return (
                  <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.04)]">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold">{t.ticker}</span>
                      <DirectionBadge dir={t.direction} />
                      {t.leverage && t.leverage > 1 && <span className="text-[9px] neon-amber">{t.leverage}x</span>}
                    </div>
                    <div className="flex items-center gap-2 text-[10px]">
                      {lp && <span className="text-muted-foreground">{fmtDollarPrice(lp)}</span>}
                      <span className={cn("font-bold font-mono", pnl >= 0 ? "neon-green" : "neon-red")}>
                        {fmtPctSigned(pnl)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-4 text-center">
              <Target className="h-5 w-5 mx-auto text-muted-foreground/30 mb-1" />
              <div className="text-[11px] text-muted-foreground">No active positions</div>
            </div>
          )}
        </div>
      </Link>

      {/* ── Signals & Quality (compact) ── */}
      <Link href="/signals" className="panel flex flex-col overflow-hidden hover:border-[rgba(0,240,255,0.25)] transition-colors rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
        <div className="panel-header flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Zap className="h-3 w-3" />
            <span>SIGNALS & QUALITY</span>
          </div>
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        </div>
        {data.totalTrades > 0 ? (
          <div className="px-3 py-2 flex items-center justify-between">
            <div className="flex items-center gap-3 text-[11px] font-mono">
              <span className={cn("font-bold", wrColor)}>{data.winRate}%</span>
              <span className="text-muted-foreground">{data.totalTrades} trades</span>
              <span className="text-muted-foreground">PF: {data.profitFactor ?? "—"}</span>
            </div>
            <span className={cn("text-sm font-bold font-mono", data.totalPnl >= 0 ? "neon-green" : "neon-red")}>
              {fmtPctSigned(data.totalPnl)}%
            </span>
          </div>
        ) : (
          <div className="px-3 py-3 text-center text-[11px] text-muted-foreground">No trade data yet</div>
        )}
        {/* Recent signal feed (compact, max 4) */}
        {data.recentSignals.length > 0 && (
          <div className="border-t border-[var(--border)] px-2 py-1.5 space-y-0">
            {data.recentSignals.slice(0, 4).map((s, i) => (
              <div key={i} className="flex items-center gap-2 px-1 py-[3px] rounded-sm hover:bg-[rgba(0,240,255,0.03)]">
                <span className="font-bold text-foreground w-[68px] truncate text-[10px]">{s.ticker}</span>
                <DirectionBadge dir={s.direction || s.signal_type || "long"} />
                <div className="flex-1" />
                <ConfidenceBar value={s.confidence} />
                <span className="text-[8px] text-muted-foreground w-10 text-right">{timeAgo(s.timestamp || s.created_at || "")}</span>
              </div>
            ))}
          </div>
        )}
      </Link>

      {/* ── AutoTrader (compact card) ── */}
      <Link href="/autotrader" className="panel hover:border-[rgba(0,240,255,0.25)] transition-colors block rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
        <div className="panel-header flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Bot className="h-3 w-3" />
            <span>AUTOTRADER</span>
            <span className={cn("ml-1 px-1.5 py-0 rounded-full text-[8px] font-bold",
              !data.auto || data.auto.status === "not_deployed"
                ? "bg-[#333] text-[#888]"
                : "bg-[var(--neon-green)] text-[#06060b]"
            )}>
              {!data.auto || data.auto.status === "not_deployed" ? "INACTIVE" : "PAPER"}
            </span>
            {health.autotrader_paused?.active && (
              <span className="px-1.5 py-0 rounded-full text-[8px] font-bold bg-amber-500/15 neon-amber border border-amber-500/30">PAUSED</span>
            )}
          </div>
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        </div>
        {atStats && atStats.total > 0 ? (
          <div className="px-3 py-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-mono text-muted-foreground">
            <span>Equity: <span className="text-foreground">${atEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></span>
            <span>P&L: <span className={cn(atStats.totalPnl >= 0 ? "neon-green" : "neon-red")}>${atStats.totalPnl >= 0 ? "+" : ""}{atStats.totalPnl.toFixed(0)}</span></span>
            <span>WR: <span className={cn(atStats.winRate >= 50 ? "neon-green" : "neon-red")}>{atStats.winRate.toFixed(1)}%</span></span>
            <span>{atStats.total} trades</span>
          </div>
        ) : (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">
            {data.auto ? `${atStats?.total ?? 0} trades completed` : "Not active"}
          </div>
        )}
      </Link>

      {/* ── Chat Preview ── */}
      <div className="panel overflow-hidden rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
        <div className="panel-header flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Send className="h-3 w-3" />
            <span>CHAT</span>
          </div>
          <div className="flex items-center gap-1">
            {data.chatHealth ? (
              <><Wifi className="h-2.5 w-2.5 text-[var(--neon-green)]" /><span className="text-[8px] neon-green font-normal">ON</span></>
            ) : (
              <><WifiOff className="h-2.5 w-2.5 text-[var(--neon-red)]" /><span className="text-[8px] neon-red font-normal">OFF</span></>
            )}
          </div>
        </div>
        <ChatMini messages={data.chatMessages} input={chatInput} setInput={setChatInput} onSend={sendChat} sending={chatSending} />
      </div>
    </div>
  );
}

/* ── Stat Cell (for grid layouts) ── */
function StatCell({ label, value, sub, color, size = "md" }: {
  label: string; value: string; sub?: string; color?: string; size?: "sm" | "md";
}) {
  return (
    <div className="bg-[var(--card)] flex flex-col items-center justify-center py-3 px-3 gap-0.5">
      <div className="stat-label">{label}</div>
      <div className={cn(
        "font-bold font-mono tabular-nums",
        size === "sm" ? "text-base" : "text-xl",
        color || "text-foreground"
      )}>{value}</div>
      {sub && <div className="text-[9px] text-muted-foreground truncate max-w-full">{sub}</div>}
    </div>
  );
}

/* ── Chat Mini Component ── */
function ChatMini({
  messages, input, setInput, onSend, sending,
}: {
  messages: ChatMsg[];
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  sending: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const last = messages.slice(-3);

  return (
    <div className="flex flex-col min-h-0">
      <div ref={scrollRef} className="overflow-auto p-2 space-y-1.5 min-h-0 max-h-24">
        {last.length === 0 && !sending && (
          <div className="flex items-center justify-center py-2 text-[10px] text-muted-foreground/40">Ask TREVOR anything</div>
        )}
        {last.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn(
              "max-w-[85%] rounded px-2 py-1 text-[10px] font-mono",
              m.role === "user"
                ? "bg-[rgba(0,180,255,0.08)] border border-[rgba(0,180,255,0.15)]"
                : "bg-[var(--card)] border border-[var(--border)] border-l-2 border-l-[var(--neon-green)]"
            )}>
              <div className="whitespace-pre-wrap break-words line-clamp-2">{m.content}</div>
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-[var(--card)] border border-[var(--border)] rounded px-2 py-1 text-[10px]">
              <span className="animate-pulse neon-text">...</span>
            </div>
          </div>
        )}
      </div>
      <div className="border-t border-[var(--border)] p-1.5">
        <div className="flex items-center gap-1.5">
          <span className="neon-text text-[10px] font-bold">&gt;</span>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && onSend()}
            placeholder="Ask TREVOR anything..."
            disabled={sending}
            className="bg-transparent border-none outline-none text-[10px] flex-1 text-foreground placeholder:text-muted-foreground font-mono"
          />
          <button onClick={onSend} disabled={sending || !input.trim()} className="neon-text disabled:opacity-30 p-1">
            <Send className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
