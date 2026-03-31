"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  TrendingUp, Activity, Zap, Clock,
  Send, Wifi, WifiOff, Target, Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { fmtDollarPrice, fmtPctSigned } from "@/lib/format";
import Link from "next/link";
import { StatBlock } from "@/components/ui/stat-block";
import { DirectionBadge } from "@/components/ui/direction-badge";
import { ConfidenceBar } from "@/components/ui/confidence-bar";
import { StatStripSkeleton, PanelSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

/* ── Types ── */
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

  useEffect(() => {
    fetchDashboard();
    const i = setInterval(fetchDashboard, 30000);
    return () => clearInterval(i);
  }, [fetchDashboard]);

  // Kill switch + system health polling
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: `${action === "activate" ? "Emergency stop" : "Resumed"} via Hub at ${new Date().toISOString()}` }),
      });
      const d = await res.json();
      setKillSwitch({ active: d.active });
    } catch { /* ignore */ }
    setKsLoading(false);
    setKsConfirm(null);
  };

  // Live prices for active trade cards
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
    fp();
    const iv = setInterval(fp, 30000);
    return () => clearInterval(iv);
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
        <div className="grid grid-cols-2 gap-2 flex-1">
          <PanelSkeleton title="SIGNALS & QUALITY" />
          <PanelSkeleton title="ACTIVE TRADES" />
          <PanelSkeleton title="AUTOTRADER" />
          <PanelSkeleton title="CHAT" />
        </div>
      </div>
    );
  }

  const decided = data.wins + data.losses;
  const winPct = decided > 0 ? ((data.wins / decided) * 100).toFixed(1) : "0";

  return (
    <div className="flex-1 overflow-hidden p-2 flex flex-col gap-1.5 md:gap-2">
      {/* ── Kill Switch Confirmation Dialog ── */}
      {ksConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="panel p-4 max-w-sm w-full mx-4 space-y-3">
            <div className="text-sm font-bold text-foreground">
              {ksConfirm === "activate" ? "HALT ALL SYSTEMS?" : "RESUME ALL SYSTEMS?"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {ksConfirm === "activate"
                ? "This will halt ALL signal generation and AutoTrader execution immediately."
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

      {/* ── Kill Switch Banner ── */}
      <div className={cn("panel shrink-0 px-3 py-2 flex items-center justify-between gap-2",
        killSwitch.active ? "border-red-500/50 bg-red-500/5" : "border-green-500/20")}>
        <div className="flex items-center gap-2">
          <span className={cn("text-[11px] font-bold", killSwitch.active ? "neon-red" : "neon-green")}>
            {killSwitch.active ? "SYSTEM HALTED" : "SYSTEM ACTIVE"}
          </span>
          {killSwitch.active && killSwitch.reason && (
            <span className="text-[9px] text-muted-foreground">{killSwitch.reason}</span>
          )}
        </div>
        <button onClick={() => setKsConfirm(killSwitch.active ? "deactivate" : "activate")}
          className={cn("px-2 py-1 text-[10px] font-bold rounded",
            killSwitch.active ? "bg-green-600/20 text-green-400 hover:bg-green-600/30" : "bg-red-600/20 text-red-400 hover:bg-red-600/30")}>
          {killSwitch.active ? "RESUME" : "EMERGENCY STOP"}
        </button>
      </div>

      {/* ── System Health ── */}
      <div className="panel shrink-0 px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]">
          <span className="text-muted-foreground">
            Scanner: {health.scanner?.status === "running" ? <span className="neon-green">Running</span> : <span className="neon-red">Unknown</span>}
          </span>
          <span className="text-muted-foreground">
            API: {health.api?.hyperliquid?.healthy ? <span className="neon-green">OK ({health.api.hyperliquid.latency_ms}ms)</span> : <span className="neon-red">DOWN</span>}
          </span>
          <span className="text-muted-foreground">
            Today: <span className="text-foreground font-mono">{health.signals?.today ?? "?"} signals</span>
          </span>
          {health.autotrader_paused?.active && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 neon-amber">AT: PAUSED</span>
          )}
          {health.circuit_breakers?.filter(cb => cb.status === "TRIPPED").map(cb => (
            <span key={cb.ticker} className="neon-red">{cb.ticker}: TRIPPED</span>
          ))}
        </div>
      </div>

      {/* ── Stat Strip ── */}
      <div className="col-span-full panel shrink-0 px-2 py-1.5 md:px-3 space-y-1">
        {/* Row 1: Core metrics */}
        <div className="grid grid-cols-4 gap-x-2">
          <StatBlock label="P&L" value={`${fmtPctSigned(data.totalPnl)}%`} color={data.totalPnl >= 0 ? "neon-green" : "neon-red"} />
          <StatBlock label="W/L" value={`${data.wins}W · ${data.losses}L`} />
          <StatBlock label="Win Rate" value={`${winPct}%`} color={Number(winPct) >= 50 ? "neon-green" : "neon-red"} />
          <StatBlock label="Active" value={String(data.activeTrades.length)} color="neon-text" />
        </div>
        {/* Row 2: Context metrics */}
        <div className="grid grid-cols-3 gap-x-2">
          <StatBlock label="XP" value={String(data.xp)} sub={data.rank} color="neon-text" />
          <StatBlock label="Signals" value={String(data.totalInsights)} />
          <StatBlock label="Avg P&L" value={`${fmtPctSigned(data.avgPnl)}%`} color={data.avgPnl >= 0 ? "neon-green" : "neon-red"} />
        </div>
        {/* Row 3: Analytics */}
        {data.totalTrades > 0 && (
          <>
            <div className="grid grid-cols-2 gap-x-2">
              <StatBlock label="R:R Ratio" value={`${data.rrRatio.toFixed(2)}R`} color={data.rrRatio >= 1.5 ? "neon-green" : data.rrRatio >= 1.0 ? "neon-amber" : "neon-red"} sub={`Win: +${data.avgWin}% | Loss: ${data.avgLoss}%`} />
              <StatBlock label="Expectancy" value={`${fmtPctSigned(data.expectancy)}%`} color={data.expectancy > 0 ? "neon-green" : data.expectancy > -0.5 ? "neon-amber" : "neon-red"} sub={data.expectancy < 0 && data.rrRatio < 1 ? "Fix: WR and R:R both underwater" : data.expectancy < 0 ? `Need WR > ${(1 / (1 + data.rrRatio) * 100).toFixed(0)}%` : "Edge positive"} />
            </div>
            <div className="text-[9px] text-muted-foreground font-mono px-0.5">
              Best: <span className="neon-green">+{data.bestTrade}%</span> | Worst: <span className="neon-red">{data.worstTrade}%</span>
              {Math.abs(data.worstTrade) > data.bestTrade && <span className="text-muted-foreground"> | asymmetric (downside)</span>}
            </div>
          </>
        )}
      </div>

      {/* ── Main Grid (2×2 desktop, stack mobile) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5 md:gap-2 flex-1 min-h-0 overflow-hidden md:overflow-auto stagger-cards dashboard-grid">

        {/* ── TOP-LEFT: Signals & Quality ── */}
        <Link href="/signals" className="panel flex flex-col overflow-hidden hover:border-[rgba(0,240,255,0.25)] transition-colors order-2 lg:order-1 max-h-[180px] md:max-h-none">
          <div className="panel-header flex items-center gap-1.5">
            <Zap className="h-3 w-3" />
            <span>SIGNALS & QUALITY</span>
            {data.recentSignals.length > 0 && (
              <span className="ml-auto text-muted-foreground font-normal text-[9px]">Recent: {data.recentSignals.length}</span>
            )}
          </div>
          {/* Quality stats ribbon */}
          {data.totalTrades > 0 && (
            <div className="flex items-center gap-4 px-2 py-1 border-b border-[var(--border)] shrink-0">
              <div className="flex items-center gap-1.5">
                <span className={cn("text-sm font-bold font-mono", data.winRate >= 55 ? "neon-green" : data.winRate < 45 ? "neon-red" : "neon-amber")}>{data.winRate}%</span>
                <span className="text-[8px] text-muted-foreground">WR</span>
              </div>
              <span className="text-[9px] text-muted-foreground">{data.totalTrades} trades</span>
              <span className="text-[9px] text-muted-foreground">PF: {data.profitFactor ?? "\u2014"}</span>
              <span className={cn("text-[9px] font-mono", data.totalPnl >= 0 ? "neon-green" : "neon-red")}>{fmtPctSigned(data.totalPnl)}%</span>
            </div>
          )}
          {/* Signal feed */}
          <div className="flex-1 overflow-auto p-1.5">
            {data.recentSignals.length > 0 ? (
              <div className="space-y-0">
                {data.recentSignals.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 px-1 py-[3px] rounded-sm hover:bg-[rgba(0,240,255,0.03)]">
                    <span className="font-bold text-foreground w-[72px] truncate text-[10px]">{s.ticker}</span>
                    <DirectionBadge dir={s.direction || s.signal_type || "long"} />
                    <div className="flex-1" />
                    <ConfidenceBar value={s.confidence} />
                    <span className="text-[8px] text-muted-foreground w-12 text-right">{timeAgo(s.timestamp || s.created_at || "")}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={Zap} message="No active signals" className="h-full" />
            )}
          </div>
        </Link>

        {/* ── TOP-RIGHT: Active Trades ── */}
        <Link href="/trades" className="panel flex flex-col overflow-hidden hover:border-[rgba(0,240,255,0.25)] transition-colors order-1 lg:order-2 max-h-[200px] md:max-h-none">
          <div className="panel-header flex items-center gap-1.5">
            <Activity className="h-3 w-3" />
            <span>ACTIVE TRADES</span>
            {data.activeTrades.length > 0 && (
              <span className="ml-1 px-1.5 py-0 rounded-full text-[8px] font-bold bg-[var(--neon-green)] text-[#06060b]">{data.activeTrades.length}</span>
            )}
          </div>
          <div className="flex-1 overflow-auto p-2">
            {data.activeTrades.length > 0 ? (
              <div className="space-y-1.5">
                {data.activeTrades.slice(0, 6).map((t, i) => {
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
                    <div key={i} className="panel p-2">
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-bold">{t.ticker}</span>
                          <DirectionBadge dir={t.direction} />
                          {t.leverage && t.leverage > 1 && <span className="text-[9px] neon-amber">{t.leverage}x</span>}
                        </div>
                        <span className={cn("text-[11px] font-bold font-mono", pnl >= 0 ? "neon-green" : "neon-red")}>
                          {fmtPctSigned(pnl)}%
                        </span>
                      </div>
                      <div className="flex gap-3 text-[9px] text-muted-foreground">
                        <span>Entry: {t.entry_price ? fmtDollarPrice(t.entry_price) : "—"}</span>
                        {lp ? <span>Now: {fmtDollarPrice(lp)}</span> : t.current_price ? <span>Now: {fmtDollarPrice(t.current_price)}</span> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={Target} message="No active positions" className="h-full" />
            )}
          </div>
        </Link>

        {/* ── BOTTOM-LEFT: AutoTrader ── */}
        <div className="order-3 flex flex-col min-h-0 max-h-[120px] md:max-h-none overflow-hidden">
          <AutoTraderPanel data={data.auto} />
        </div>

        {/* ── BOTTOM-RIGHT: Chat ── */}
        <div className="panel flex flex-col overflow-hidden order-4 max-h-[100px] md:max-h-none">
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
    </div>
  );
}

/* ── AutoTrader Panel ── */
function AutoTraderPanel({ data }: { data: AutoData | null }) {
  const notDeployed = !data || data.status === "not_deployed";
  const stats = data?.stats;
  const positions = data?.positions ?? [];
  const signals = data?.recentSignals ?? [];
  const equity = (data as Record<string, unknown>)?.account
    ? ((data as Record<string, unknown>).account as Record<string, number>)?.equity ?? 0
    : 0;

  return (
    <div className="panel flex flex-col overflow-hidden max-h-[200px] md:max-h-none">
      <div className="panel-header flex items-center gap-1.5">
        <Bot className="h-3 w-3" />
        <span>AUTOTRADER</span>
        <span className={cn("ml-1 px-1.5 py-0 rounded-full text-[8px] font-bold", notDeployed ? "bg-[#333] text-[#888]" : "bg-[var(--neon-green)] text-[#06060b]")}>
          {notDeployed ? "INACTIVE" : "PAPER"}
        </span>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {notDeployed ? (
          <EmptyState icon={Bot} message="AutoTrader not active" className="h-full" />
        ) : (
          <div className="space-y-2">
            {/* Stats row */}
            <div className="grid grid-cols-4 gap-1.5">
              <MiniStat label="Equity" value={`$${equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
              <MiniStat label="Total P&L" value={`$${(stats?.totalPnl ?? 0) >= 0 ? "+" : ""}${(stats?.totalPnl ?? 0).toFixed(0)}`} color={(stats?.totalPnl ?? 0) >= 0 ? "neon-green" : "neon-red"} />
              <MiniStat label="Win Rate" value={`${(stats?.winRate ?? 0).toFixed(1)}%`} color={(stats?.winRate ?? 0) >= 50 ? "neon-green" : "neon-red"} />
              <MiniStat label="Daily P&L" value={`$${(data?.dailyPnl ?? 0) >= 0 ? "+" : ""}${(data?.dailyPnl ?? 0).toFixed(0)}`} color={(data?.dailyPnl ?? 0) >= 0 ? "neon-green" : "neon-red"} />
            </div>

            {/* Open positions */}
            {positions.length > 0 && (
              <div>
                <div className="text-[8px] text-muted-foreground uppercase mb-1">Open Positions</div>
                {positions.slice(0, 4).map((p, i) => (
                  <div key={i} className="flex items-center gap-2 px-1 py-[3px] rounded-sm hover:bg-[rgba(0,240,255,0.03)]">
                    <span className="text-[10px] font-bold w-16 truncate">{p.ticker}</span>
                    <DirectionBadge dir={p.side === "BUY" ? "LONG" : "SHORT"} />
                    <span className="text-[9px] text-muted-foreground flex-1">{fmtDollarPrice(p.entry_price)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Recent signals */}
            {signals.length > 0 && (
              <div>
                <div className="text-[8px] text-muted-foreground uppercase mb-1">Recent Signals</div>
                {signals.slice(0, 5).map((s, i) => {
                  const executed = s.action === "EXECUTE" || s.action?.includes("EXECUTE");
                  return (
                    <div key={i} className="flex items-center gap-2 px-1 py-[3px] rounded-sm hover:bg-[rgba(0,240,255,0.03)]">
                      <span className="text-[10px] font-bold w-14 truncate">{s.ticker}</span>
                      <DirectionBadge dir={s.direction} />
                      <span className="text-[9px] text-muted-foreground">{s.tier3_score?.toFixed(0)}</span>
                      <span className={cn("text-[8px] font-bold", executed ? "neon-green" : "text-muted-foreground")}>{executed ? "EXEC" : "SKIP"}</span>
                      <span className="text-[8px] text-muted-foreground ml-auto">{formatET(s.created_at)}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {positions.length === 0 && signals.length === 0 && (
              <div className="text-[9px] text-muted-foreground text-center py-4 opacity-50">
                {(stats?.total ?? 0) > 0 ? `${stats?.total} trades completed` : "Waiting for first trade..."}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="panel p-1.5 text-center">
      <div className={cn("text-[11px] font-bold font-mono tabular-nums", color || "neon-text")}>{value}</div>
      <div className="text-[7px] text-muted-foreground uppercase">{label}</div>
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

  const last = messages.slice(-4);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div ref={scrollRef} className="flex-1 overflow-auto p-2 space-y-1.5 min-h-0">
        {last.length === 0 && !sending && (
          <div className="flex items-center justify-center h-full text-[9px] text-muted-foreground opacity-50">Ask TREVOR anything</div>
        )}
        {last.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn(
              "max-w-[85%] rounded px-2 py-1 text-[10px] font-mono",
              m.role === "user" ? "bg-[rgba(0,240,255,0.08)] border border-[rgba(0,240,255,0.15)]" : "bg-[var(--card)] border border-[var(--border)]"
            )}>
              <div className="whitespace-pre-wrap break-words line-clamp-3">{m.content}</div>
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-[var(--card)] border border-[var(--border)] rounded px-2 py-1 text-[10px]">
              <span className="animate-pulse text-[var(--neon-cyan)]">...</span>
            </div>
          </div>
        )}
      </div>
      <div className="border-t border-[var(--border)] p-1.5 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--neon-cyan)] text-[10px] font-bold">&gt;</span>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && onSend()}
            placeholder="Ask TREVOR anything..."
            disabled={sending}
            className="bg-transparent border-none outline-none text-[10px] flex-1 text-foreground placeholder:text-muted-foreground font-mono"
          />
          <button onClick={onSend} disabled={sending || !input.trim()} className="text-[var(--neon-cyan)] disabled:opacity-30">
            <Send className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
