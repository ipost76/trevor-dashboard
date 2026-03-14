"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  TrendingUp, TrendingDown, Activity, Zap, Clock, CheckCircle, XCircle,
  RefreshCw, DollarSign, Target, Brain, Database, Calendar, Send,
  Wifi, WifiOff, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import Link from "next/link";
import { Panel } from "@/components/ui/panel";
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
type ScheduleJob = { name: string; enabled: boolean; schedule: string; nextRun: string };

type DashboardData = {
  // From /api/live
  xp: number; rank: string; totalInsights: number; todayCost: number;
  recentSignals: Signal[]; activeTrades: ActiveTrade[];
  logTail: string[];
  // From /api/signal-quality
  winRate: number; totalTrades: number; profitFactor: number | null;
  avgPnl: number; totalPnl: number; wins: number; losses: number;
  calibration: Record<string, CalBucket>;
  // From /api/chat
  chatMessages: ChatMsg[]; chatHealth: boolean;
  // From /api/schedule
  jobs: ScheduleJob[];
  // From /api/memory
  patternCount: number; kbCount: number; dailyFileCount: number;
  brainStats: Record<string, { exists: boolean; modified: string; size: number }>;
};

const EMPTY: DashboardData = {
  xp: 0, rank: "Unknown", totalInsights: 0, todayCost: 0,
  recentSignals: [], activeTrades: [], logTail: [],
  winRate: 0, totalTrades: 0, profitFactor: null, avgPnl: 0,
  totalPnl: 0, wins: 0, losses: 0, calibration: {},
  chatMessages: [], chatHealth: false,
  jobs: [], patternCount: 0, kbCount: 0, dailyFileCount: 0,
  brainStats: {},
};

export function DashboardView() {
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);

  const fetchDashboard = useCallback(async () => {
    const [live, sq, chat, sched, mem] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      safeFetch<any>("/api/live", null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      safeFetch<any>("/api/signal-quality", null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      safeFetch<any>("/api/chat?action=history&limit=5", null),
      safeFetch<{ jobs?: ScheduleJob[] }>("/api/schedule", {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      safeFetch<any>("/api/memory", null),
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
      calibration: sq?.calibration ?? {},
      chatMessages: chat?.messages ?? [],
      chatHealth: chat?.ok !== false,
      jobs: sched?.jobs ?? [],
      patternCount: mem?.patternCount ?? 0,
      kbCount: mem?.kbCount ?? 0,
      dailyFileCount: mem?.dailyFiles?.length ?? 0,
      brainStats: mem?.brainStats ?? {},
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDashboard();
    const i = setInterval(fetchDashboard, 15000);
    return () => clearInterval(i);
  }, [fetchDashboard]);

  const sendChat = useCallback(async () => {
    const msg = chatInput.trim();
    if (!msg || chatSending) return;
    setChatInput("");
    setChatSending(true);
    setData(prev => ({
      ...prev,
      chatMessages: [...prev.chatMessages, { role: "user", content: msg, timestamp: new Date().toISOString() }],
    }));
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const d = await res.json();
      setData(prev => ({
        ...prev,
        chatMessages: [...prev.chatMessages, { role: "assistant", content: d.response || d.error || "No response", timestamp: new Date().toISOString() }],
      }));
    } catch {
      setData(prev => ({
        ...prev,
        chatMessages: [...prev.chatMessages, { role: "assistant", content: "[Connection error]", timestamp: new Date().toISOString() }],
      }));
    }
    setChatSending(false);
  }, [chatInput, chatSending]);

  if (loading) {
    return (
      <div className="flex-1 overflow-hidden p-2 flex flex-col gap-2">
        <StatStripSkeleton />
        <div className="grid grid-cols-3 gap-2 flex-1">
          <PanelSkeleton title="SIGNAL QUALITY" />
          <PanelSkeleton title="ACTIVE TRADES" />
          <PanelSkeleton title="CHAT" />
          <PanelSkeleton title="SIGNAL FEED" />
          <div className="col-span-2"><PanelSkeleton title="SYSTEM STATUS" /></div>
        </div>
      </div>
    );
  }

  const decided = data.wins + data.losses;
  const winPct = decided > 0 ? ((data.wins / decided) * 100).toFixed(0) : "0";
  const enabledJobs = data.jobs.filter(j => j.enabled).length;

  return (
    <div className="flex-1 overflow-hidden p-2 flex flex-col gap-2">
      {/* ── Stat Strip ── */}
      <div className="col-span-full panel shrink-0">
        <div className="flex items-center gap-5 px-3 py-1.5 flex-wrap">
          <StatBlock
            label="Total P&L"
            value={`${data.totalPnl >= 0 ? "+" : ""}${data.totalPnl.toFixed(1)}%`}
            color={data.totalPnl >= 0 ? "neon-green" : "neon-red"}
          />
          <StatBlock label="W / L" value={`${data.wins}W ${data.losses}L`} sub={`${winPct}% win rate`} />
          <StatBlock label="Win Rate" value={`${data.winRate.toFixed(0)}%`} color={data.winRate >= 55 ? "neon-green" : data.winRate < 45 ? "neon-red" : "neon-amber"} />
          <StatBlock label="Active" value={String(data.activeTrades.length)} color="neon-text" />
          <StatBlock label="XP" value={String(data.xp)} sub={data.rank} color="neon-text" />
          <StatBlock label="Signals" value={String(data.totalInsights)} />
          <StatBlock label="Avg P&L" value={`${data.avgPnl >= 0 ? "+" : ""}${data.avgPnl.toFixed(2)}%`} color={data.avgPnl >= 0 ? "neon-green" : "neon-red"} />
          <StatBlock label="Cost Today" value={`$${data.todayCost.toFixed(3)}`} sub="/ $0.250" />
        </div>
      </div>

      {/* ── Main Grid (2 rows, 3 cols) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 flex-1 min-h-0 stagger-cards"
           style={{ gridTemplateRows: "1fr 1fr" }}>

        {/* ── R1C1: Signal Quality ── */}
        <Link href="/signals" className="panel flex flex-col overflow-hidden hover:border-[rgba(0,240,255,0.25)] transition-colors">
          <div className="panel-header flex items-center gap-1.5">
            <Target className="h-3 w-3" />
            <span>SIGNAL QUALITY</span>
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-2">
            {data.totalTrades > 0 ? (
              <>
                <div className="flex items-center gap-4">
                  <div>
                    <div className={cn("text-2xl font-bold font-mono", data.winRate >= 55 ? "neon-green" : data.winRate < 45 ? "neon-red" : "neon-amber")}>
                      {data.winRate}%
                    </div>
                    <div className="text-[8px] text-muted-foreground uppercase">Win Rate</div>
                  </div>
                  <div className="text-right flex-1">
                    <div className="text-[10px] text-muted-foreground">{data.totalTrades} trades</div>
                    <div className="text-[10px] text-muted-foreground">PF: {data.profitFactor ?? "—"}</div>
                  </div>
                </div>
                {/* Calibration bars */}
                <div className="space-y-1">
                  {["50-60", "60-70", "70-80", "80-90", "90+"].map(bucket => {
                    const b = data.calibration[bucket];
                    if (!b || b.trades === 0) return null;
                    const maxT = Math.max(1, ...Object.values(data.calibration).map(v => v?.trades || 0));
                    const barW = (b.trades / maxT) * 100;
                    const midpoint = bucket === "90+" ? 92.5 : (parseInt(bucket) + parseInt(bucket.split("-")[1] || "100")) / 2;
                    const calibrated = b.winRate != null && b.winRate >= midpoint;
                    return (
                      <div key={bucket} className="flex items-center gap-2">
                        <span className="text-[8px] text-muted-foreground w-8 shrink-0">{bucket}%</span>
                        <div className="flex-1 h-2 rounded-sm bg-[var(--muted)] overflow-hidden">
                          <div className="h-full rounded-sm" style={{ width: `${barW}%`, backgroundColor: calibrated ? "var(--neon-green)" : "var(--neon-red)", opacity: 0.7 }} />
                        </div>
                        <span className={cn("text-[8px] font-bold w-10 text-right", calibrated ? "neon-green" : "neon-red")}>
                          {b.winRate}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <EmptyState icon={Target} message="No signal data yet" className="h-full" />
            )}
          </div>
        </Link>

        {/* ── R1C2: Active Trades ── */}
        <Link href="/trades" className="panel flex flex-col overflow-hidden hover:border-[rgba(0,240,255,0.25)] transition-colors">
          <div className="panel-header flex items-center gap-1.5">
            <Activity className="h-3 w-3" />
            <span>ACTIVE TRADES</span>
            <span className="ml-auto text-muted-foreground font-normal">{data.activeTrades.length}</span>
          </div>
          <div className="flex-1 overflow-auto p-2">
            {data.activeTrades.length > 0 ? (
              <div className="space-y-1.5">
                {data.activeTrades.slice(0, 5).map((t, i) => {
                  const pnl = t.leveraged_pnl_pct ?? t.pnl_pct ?? 0;
                  return (
                    <div key={i} className="panel p-2">
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-bold">{t.ticker}</span>
                          <DirectionBadge dir={t.direction} />
                          {t.leverage && t.leverage > 1 && <span className="text-[9px] neon-amber">{t.leverage}x</span>}
                        </div>
                        <span className={cn("text-[11px] font-bold font-mono", pnl >= 0 ? "neon-green" : "neon-red")}>
                          {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
                        </span>
                      </div>
                      <div className="flex gap-3 text-[9px] text-muted-foreground">
                        <span>Entry: ${t.entry_price?.toFixed(2)}</span>
                        {t.current_price && <span>Now: ${t.current_price.toFixed(2)}</span>}
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

        {/* ── R1C3: Chat (Compact) ── */}
        <div className="panel flex flex-col overflow-hidden">
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

        {/* ── R2C1: Signal Feed ── */}
        <Panel title="SIGNAL FEED" headerRight={<span className="text-muted-foreground font-normal text-[9px]">{data.recentSignals.length}</span>}>
          {data.recentSignals.length > 0 ? (
            <div className="space-y-0">
              {data.recentSignals.slice(0, 6).map((s, i) => (
                <div key={i} className="flex items-center gap-2 data-cell hover:bg-[rgba(0,240,255,0.03)]">
                  <span className="font-bold text-foreground w-14 truncate text-[10px]">{s.ticker}</span>
                  <DirectionBadge dir={s.direction || "long"} />
                  <span className="text-[9px] text-muted-foreground flex-1 truncate">{s.signal_type}</span>
                  <ConfidenceBar value={s.confidence} />
                  {s.outcome === "win" && <CheckCircle className="h-3 w-3 text-[var(--neon-green)]" />}
                  {s.outcome === "loss" && <XCircle className="h-3 w-3 text-[var(--neon-red)]" />}
                  {!s.outcome && <Clock className="h-3 w-3 text-muted-foreground" />}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Activity} message="No signals yet" className="h-full" />
          )}
        </Panel>

        {/* ── R2C2-C3: Memory & System Status ── */}
        <div className="lg:col-span-2 panel flex flex-col overflow-hidden">
          <div className="panel-header">MEMORY & SYSTEM STATUS</div>
          <div className="flex-1 overflow-auto p-2">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
              {/* ChromaDB */}
              <div className="panel p-2">
                <div className="flex items-center gap-1 mb-1">
                  <Database className="h-2.5 w-2.5 text-[var(--neon-magenta)]" />
                  <span className="text-[8px] font-bold text-muted-foreground uppercase">ChromaDB</span>
                </div>
                <div className="text-[13px] font-bold neon-text">{data.patternCount}</div>
                <div className="text-[8px] text-muted-foreground">Patterns</div>
                <div className="text-[13px] font-bold neon-text mt-0.5">{data.kbCount}</div>
                <div className="text-[8px] text-muted-foreground">KB Entries</div>
              </div>

              {/* Schedule */}
              <div className="panel p-2">
                <div className="flex items-center gap-1 mb-1">
                  <Calendar className="h-2.5 w-2.5 text-[var(--neon-cyan)]" />
                  <span className="text-[8px] font-bold text-muted-foreground uppercase">Schedule</span>
                </div>
                <div className="text-[13px] font-bold neon-green">{enabledJobs}/{data.jobs.length}</div>
                <div className="text-[8px] text-muted-foreground">Jobs Active</div>
                {data.jobs.filter(j => j.enabled)[0] && (
                  <div className="text-[8px] text-muted-foreground mt-1 truncate">
                    Next: {data.jobs.filter(j => j.enabled)[0].name.replace(/_/g, " ")}
                  </div>
                )}
              </div>

              {/* Cost */}
              <div className="panel p-2">
                <div className="flex items-center gap-1 mb-1">
                  <DollarSign className="h-2.5 w-2.5 text-[var(--neon-amber)]" />
                  <span className="text-[8px] font-bold text-muted-foreground uppercase">Cost</span>
                </div>
                <div className={cn("text-[13px] font-bold font-mono", data.todayCost > 0.2 ? "neon-red" : data.todayCost > 0.15 ? "neon-amber" : "neon-green")}>
                  ${data.todayCost.toFixed(3)}
                </div>
                <div className="text-[8px] text-muted-foreground">Today / $0.250</div>
                <div className="h-1 rounded-full bg-[rgba(255,255,255,0.04)] mt-1">
                  <div className="h-full rounded-full bg-[var(--neon-cyan)]" style={{ width: `${Math.min(100, (data.todayCost / 0.25) * 100)}%` }} />
                </div>
              </div>

              {/* Brain Health */}
              <div className="panel p-2">
                <div className="flex items-center gap-1 mb-1">
                  <Brain className="h-2.5 w-2.5 text-[var(--neon-cyan)]" />
                  <span className="text-[8px] font-bold text-muted-foreground uppercase">Brain</span>
                </div>
                <div className="text-[13px] font-bold neon-text">{data.dailyFileCount}</div>
                <div className="text-[8px] text-muted-foreground">Daily Files</div>
                <div className="text-[13px] font-bold neon-green mt-0.5">
                  {Object.values(data.brainStats).filter(s => s.exists).length}/{Object.keys(data.brainStats).length}
                </div>
                <div className="text-[8px] text-muted-foreground">Brain Files</div>
              </div>
            </div>

            {/* Recent Logs */}
            <div className="font-mono text-[9px] space-y-0.5">
              {data.logTail.slice(-6).map((line, i) => {
                const isErr = line.includes("ERROR") || line.includes("CRITICAL");
                const isWarn = line.includes("WARNING");
                return (
                  <div key={i} className={cn(
                    "px-1 py-0.5 rounded-sm truncate",
                    isErr ? "text-[var(--neon-red)] bg-[rgba(255,51,102,0.05)]" :
                    isWarn ? "text-[var(--neon-amber)] bg-[rgba(255,170,0,0.05)]" :
                    "text-muted-foreground"
                  )}>
                    {line}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
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
          <div className="flex items-center justify-center h-full text-[9px] text-muted-foreground opacity-50">
            Type a command below
          </div>
        )}
        {last.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn(
              "max-w-[85%] rounded px-2 py-1 text-[10px] font-mono",
              m.role === "user"
                ? "bg-[rgba(0,240,255,0.08)] border border-[rgba(0,240,255,0.15)]"
                : "bg-[var(--card)] border border-[var(--border)]"
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
            placeholder="Command..."
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
