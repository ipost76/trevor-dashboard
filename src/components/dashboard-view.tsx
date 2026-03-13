"use client";
import { useEffect, useState, useCallback } from "react";
import { TrendingUp, TrendingDown, Activity, Zap, Clock, CheckCircle, XCircle, AlertCircle, RefreshCw, DollarSign, Target, BarChart3, Brain, Database, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import Link from "next/link";

type LiveData = {
  xp: number;
  rank: string;
  totalInsights: number;
  recentSignals: Array<{
    id: number;
    ticker: string;
    signal_type: string;
    confidence: number;
    outcome: string;
    created_at: string;
    direction?: string;
  }>;
  outcomes: Array<{
    ticker: string;
    pnl_pct: number;
    direction: string;
    exit_reason: string;
    created_at: string;
    leveraged_pnl_pct?: number;
  }>;
  watchlist: Array<{
    ticker: string;
    priority: string;
    mode: string;
    asset_type: string;
  }>;
  trainingStats: {
    totalTrades: number;
    versions: string[];
    signalTypes: number;
  };
  activeTrades: Array<{
    ticker: string;
    direction: string;
    entry_price: number;
    current_price?: number;
    pnl_pct?: number;
    leverage?: number;
  }>;
  todayCost: number;
  logTail: string[];
};

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("panel flex flex-col overflow-hidden", className)}>
      <div className="panel-header flex items-center justify-between">
        <span>{title}</span>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {children}
      </div>
    </div>
  );
}

function StatBlock({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="stat-label">{label}</div>
      <div className={cn("stat-value", color || "text-foreground")}>{value}</div>
      {sub && <div className="text-[9px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function DirectionBadge({ dir }: { dir: string }) {
  const isLong = dir?.toLowerCase() === "long" || dir?.toLowerCase() === "buy";
  return <span className={isLong ? "badge-long" : "badge-short"}>{isLong ? "LONG" : "SHORT"}</span>;
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  const color = pct >= 70 ? "var(--neon-green)" : pct >= 50 ? "var(--neon-amber)" : "var(--neon-red)";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 w-12 rounded-full bg-[rgba(255,255,255,0.06)]">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[10px] font-mono" style={{ color }}>{pct}%</span>
    </div>
  );
}

export function DashboardView() {
  const [data, setData] = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await safeFetch<any>("/api/live", null);
    if (raw) {
      setData({
        xp: raw.xp ?? 0,
        rank: raw.rank ?? "Unknown",
        totalInsights: raw.signals?.total ?? raw.totalInsights ?? 0,
        recentSignals: raw.recentSignals ?? [],
        outcomes: raw.outcomes ?? [],
        watchlist: (raw.watchlist ?? []).map((w: Record<string, string>) => ({
          ticker: w.ticker,
          priority: w.priority ?? w.track ?? "",
          mode: w.mode ?? w.track ?? "",
          asset_type: w.asset_type ?? w.type ?? "",
        })),
        trainingStats: {
          totalTrades: raw.trainingStats?.totalTrades ?? raw.trainingStats?.trades ?? 0,
          versions: raw.trainingStats?.versions ?? [],
          signalTypes: raw.trainingStats?.signalTypes ?? 0,
        },
        activeTrades: raw.activeTrades ?? raw.activeScalps ?? [],
        todayCost: raw.todayCost ?? raw.cost_today ?? 0,
        logTail: raw.logTail ?? raw.logs ?? [],
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const i = setInterval(fetchData, 15000);
    return () => clearInterval(i);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <RefreshCw className="h-5 w-5 animate-spin text-[var(--neon-cyan)]" />
          <span className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground">Loading systems...</span>
        </div>
      </div>
    );
  }

  const winCount = data?.outcomes?.filter(o => o.pnl_pct > 0).length || 0;
  const lossCount = data?.outcomes?.filter(o => o.pnl_pct <= 0).length || 0;
  const totalPnl = data?.outcomes?.reduce((s, o) => s + (o.leveraged_pnl_pct ?? o.pnl_pct ?? 0), 0) || 0;

  return (
    <div className="flex-1 overflow-auto p-2">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 h-full stagger-cards" style={{ gridTemplateRows: "auto 1fr 1fr" }}>

        {/* Row 1: Stat Strip */}
        <div className="col-span-full panel">
          <div className="panel-header">PORTFOLIO OVERVIEW</div>
          <div className="flex items-center gap-6 p-3 flex-wrap">
            <StatBlock
              label="Total P&L"
              value={`${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}%`}
              color={totalPnl >= 0 ? "neon-green" : "neon-red"}
            />
            <StatBlock label="Win / Loss" value={`${winCount}W ${lossCount}L`} sub={`${winCount + lossCount > 0 ? ((winCount / (winCount + lossCount)) * 100).toFixed(0) : 0}% win rate`} />
            <StatBlock label="Active Trades" value={String(data?.activeTrades?.length || 0)} color="neon-text" />
            <StatBlock label="Signals Today" value={String(data?.recentSignals?.length || 0)} />
            <StatBlock label="Training Data" value={data?.trainingStats?.totalTrades?.toLocaleString() || "0"} sub={`${data?.trainingStats?.signalTypes || 0} signal types`} />
            <StatBlock label="XP" value={String(data?.xp || 0)} sub={data?.rank || "Unknown"} color="neon-text" />
            <StatBlock label="Cost Today" value={`$${(data?.todayCost || 0).toFixed(3)}`} sub="/ $0.250 budget" />
          </div>
        </div>

        {/* Panel: Signal Feed */}
        <Panel title="SIGNAL FEED" className="row-span-2">
          <div className="space-y-0">
            {data?.recentSignals?.slice(0, 20).map((s, i) => (
              <div key={s.id || i} className="flex items-center gap-2 data-cell hover:bg-[rgba(0,240,255,0.03)]">
                <span className="font-bold text-foreground w-16 truncate">{s.ticker}</span>
                <DirectionBadge dir={s.direction || "long"} />
                <span className="text-[9px] text-muted-foreground flex-1 truncate">{s.signal_type}</span>
                <ConfidenceBar value={s.confidence} />
                {s.outcome === "win" && <CheckCircle className="h-3 w-3 text-[var(--neon-green)]" />}
                {s.outcome === "loss" && <XCircle className="h-3 w-3 text-[var(--neon-red)]" />}
                {!s.outcome && <Clock className="h-3 w-3 text-muted-foreground" />}
              </div>
            ))}
            {(!data?.recentSignals || data.recentSignals.length === 0) && (
              <div className="text-[10px] text-muted-foreground text-center py-4">No signals yet</div>
            )}
          </div>
        </Panel>

        {/* Panel: Active Positions */}
        <Panel title="ACTIVE POSITIONS">
          {data?.activeTrades && data.activeTrades.length > 0 ? (
            <div className="space-y-1">
              {data.activeTrades.map((t, i) => (
                <div key={i} className="panel p-2">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold">{t.ticker}</span>
                      <DirectionBadge dir={t.direction} />
                      {t.leverage && t.leverage > 1 && (
                        <span className="text-[9px] text-[var(--neon-amber)]">{t.leverage}x</span>
                      )}
                    </div>
                    <span className={cn(
                      "text-xs font-bold font-mono",
                      (t.pnl_pct || 0) >= 0 ? "neon-green" : "neon-red"
                    )}>
                      {(t.pnl_pct || 0) >= 0 ? "+" : ""}{(t.pnl_pct || 0).toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex gap-3 text-[9px] text-muted-foreground">
                    <span>Entry: ${t.entry_price?.toFixed(2)}</span>
                    {t.current_price && <span>Now: ${t.current_price.toFixed(2)}</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Target className="h-5 w-5 mb-1 opacity-30" />
              <span className="text-[10px]">No active positions</span>
            </div>
          )}
        </Panel>

        {/* Panel: Recent Outcomes */}
        <Panel title="TRADE OUTCOMES">
          {data?.outcomes && data.outcomes.length > 0 ? (
            <div className="space-y-0">
              {data.outcomes.slice(0, 10).map((o, i) => (
                <div key={i} className="flex items-center gap-2 data-cell">
                  <span className="font-bold text-foreground w-14 truncate text-[11px]">{o.ticker}</span>
                  <DirectionBadge dir={o.direction} />
                  <span className={cn(
                    "text-[11px] font-bold font-mono flex-1 text-right",
                    o.pnl_pct >= 0 ? "neon-green" : "neon-red"
                  )}>
                    {o.pnl_pct >= 0 ? "+" : ""}{o.pnl_pct.toFixed(2)}%
                  </span>
                  <span className="text-[9px] text-muted-foreground w-12 text-right truncate">{o.exit_reason}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-[10px] text-muted-foreground">No outcomes recorded</div>
          )}
        </Panel>

        {/* Panel: Watchlist */}
        <Panel title="WATCHLIST">
          <div className="space-y-0">
            {data?.watchlist?.map((w, i) => (
              <div key={i} className="flex items-center gap-2 data-cell">
                <span className="font-bold text-foreground text-[11px] w-20 truncate">{w.ticker}</span>
                <span className={cn(
                  "text-[9px] px-1.5 py-0 rounded border",
                  w.mode === "scalp"
                    ? "bg-[rgba(255,0,255,0.08)] text-[var(--neon-magenta)] border-[rgba(255,0,255,0.2)]"
                    : "bg-[rgba(0,240,255,0.08)] text-[var(--neon-cyan)] border-[rgba(0,240,255,0.2)]"
                )}>
                  {w.mode || "LT"}
                </span>
                <span className="text-[9px] text-muted-foreground flex-1">{w.asset_type}</span>
                <span className="text-[9px] text-muted-foreground">{w.priority}</span>
              </div>
            ))}
          </div>
        </Panel>

        {/* Panel: System Log */}
        <Panel title="SYSTEM LOG">
          <div className="font-mono text-[10px] space-y-0.5">
            {data?.logTail?.slice(-15).map((line, i) => {
              const isError = line.includes("ERROR") || line.includes("CRITICAL");
              const isWarn = line.includes("WARNING");
              return (
                <div key={i} className={cn(
                  "px-1 py-0.5 rounded-sm truncate",
                  isError ? "text-[var(--neon-red)] bg-[rgba(255,51,102,0.05)]" :
                  isWarn ? "text-[var(--neon-amber)] bg-[rgba(255,170,0,0.05)]" :
                  "text-muted-foreground"
                )}>
                  {line}
                </div>
              );
            })}
            {(!data?.logTail || data.logTail.length === 0) && (
              <div className="text-muted-foreground text-center py-4">No log entries</div>
            )}
          </div>
        </Panel>
      </div>

      {/* v2.0 Mini Widgets */}
      <V2Widgets />
    </div>
  );
}

function V2Widgets() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sq, setSq] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [mem, setMem] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sched, setSched] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [kb, setKb] = useState<any>(null);

  useEffect(() => {
    safeFetch("/api/signal-quality", null).then(setSq);
    safeFetch("/api/memory", null).then(setMem);
    safeFetch("/api/schedule", null).then(setSched);
    safeFetch("/api/knowledge/stats", null).then(setKb);
  }, []);

  const enabledJobs = sched?.jobs?.filter((j: { enabled: boolean }) => j.enabled)?.length || 0;
  const totalJobs = sched?.jobs?.length || 0;
  const nextJob = sched?.jobs?.find((j: { enabled: boolean }) => j.enabled);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-2 stagger-cards">
      {/* Signal Quality Mini */}
      <Link href="/signal-quality" className="panel p-2.5 hover:border-[rgba(0,240,255,0.25)] transition-colors">
        <div className="flex items-center gap-1.5 mb-2">
          <Target className="h-3 w-3 text-[var(--neon-cyan)]" />
          <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--neon-cyan)]">Signal Quality</span>
        </div>
        {sq?.overall?.totalTrades > 0 ? (
          <div className="flex items-center gap-3">
            <div>
              <div className={cn("text-lg font-bold font-mono", sq.overall.winRate >= 55 ? "neon-green" : sq.overall.winRate < 45 ? "neon-red" : "neon-amber")}>
                {sq.overall.winRate}%
              </div>
              <div className="text-[8px] text-muted-foreground">WIN RATE</div>
            </div>
            <div className="flex-1 text-right">
              <div className="text-[10px] text-muted-foreground">{sq.overall.totalTrades} trades</div>
              <div className="text-[10px] text-muted-foreground">PF: {sq.overall.profitFactor ?? "—"}</div>
            </div>
          </div>
        ) : (
          <div className="text-[10px] text-muted-foreground">No data yet</div>
        )}
      </Link>

      {/* Memory Mini */}
      <Link href="/memory" className="panel p-2.5 hover:border-[rgba(0,240,255,0.25)] transition-colors">
        <div className="flex items-center gap-1.5 mb-2">
          <Brain className="h-3 w-3 text-[var(--neon-cyan)]" />
          <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--neon-cyan)]">Memory</span>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">Daily files</span>
            <span className="text-foreground font-bold">{mem?.dailyFiles?.length || 0}</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">Patterns</span>
            <span className="text-foreground font-bold">{mem?.patternCount || 0}</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">KB entries</span>
            <span className="text-foreground font-bold">{mem?.kbCount || 0}</span>
          </div>
        </div>
      </Link>

      {/* KB Mini */}
      <Link href="/knowledge" className="panel p-2.5 hover:border-[rgba(0,240,255,0.25)] transition-colors">
        <div className="flex items-center gap-1.5 mb-2">
          <Database className="h-3 w-3 text-[var(--neon-cyan)]" />
          <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--neon-cyan)]">Knowledge Base</span>
        </div>
        <div className="text-lg font-bold font-mono neon-text">{kb?.total_entries || 0}</div>
        <div className="text-[8px] text-muted-foreground">TOTAL ENTRIES</div>
        <div className="text-[9px] text-[var(--neon-cyan)] mt-1">Search KB →</div>
      </Link>

      {/* Schedule Mini */}
      <Link href="/schedule" className="panel p-2.5 hover:border-[rgba(0,240,255,0.25)] transition-colors">
        <div className="flex items-center gap-1.5 mb-2">
          <Calendar className="h-3 w-3 text-[var(--neon-cyan)]" />
          <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--neon-cyan)]">Schedule</span>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">Jobs</span>
            <span className="neon-green font-bold">{enabledJobs}/{totalJobs}</span>
          </div>
          {nextJob && (
            <div className="text-[10px]">
              <span className="text-muted-foreground">Next: </span>
              <span className="text-foreground">{nextJob.name.replace(/_/g, " ")}</span>
            </div>
          )}
        </div>
      </Link>
    </div>
  );
}
