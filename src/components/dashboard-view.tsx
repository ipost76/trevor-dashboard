"use client";
import { useState, useCallback } from "react";
import { TrendingUp, TrendingDown, Activity, Zap, Clock, CheckCircle, XCircle, AlertCircle, RefreshCw, DollarSign, Target, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { usePolling } from "@/lib/use-polling";

type LiveData = {
  xp: number;
  rank: string;
  totalInsights: number;
  recentSignals: Array<{
    id: number; ticker: string; signal_type: string; confidence: number;
    outcome: string | null; timestamp: string; direction?: string;
    entry_price?: number; target_price?: number; stop_price?: number;
  }>;
  outcomes: { wins: number; losses: number };
  watchlist: Array<{ ticker: string; priority: number; mode: string; asset_type: string }>;
  trainingStats: { trades: number; observations: number; sentiment: number };
  todayCost: number;
  logTail: string[];
  dbSizeMB: number;
};

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("panel flex flex-col overflow-hidden", className)}>
      <div className="panel-header flex items-center justify-between"><span>{title}</span></div>
      <div className="flex-1 overflow-auto p-2">{children}</div>
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
        rank: raw.rank ?? "Intern Quant",
        totalInsights: raw.signals?.total ?? 0,
        recentSignals: (raw.recentSignals ?? []).map((s: Record<string, unknown>) => ({
          ...s,
          timestamp: s.timestamp || s.created_at || "",
        })),
        outcomes: { wins: raw.signals?.wins ?? 0, losses: raw.signals?.losses ?? 0 },
        watchlist: (raw.watchlist ?? []).map((w: Record<string, unknown>) => ({
          ticker: w.ticker,
          priority: w.priority ?? 2,
          mode: w.mode ?? "lt",
          asset_type: w.asset_type ?? "stock",
        })),
        trainingStats: {
          trades: raw.trainingStats?.trades ?? 0,
          observations: raw.trainingStats?.observations ?? 0,
          sentiment: raw.trainingStats?.sentiment ?? 0,
        },
        todayCost: raw.costToday ?? raw.cost_today ?? 0,
        logTail: raw.logs ?? [],
        dbSizeMB: raw.dbSizeMB ?? 0,
      });
    }
    setLoading(false);
  }, []);

  usePolling(fetchData, 30000);

  if (loading) {
    return (
      <div className="flex-1 overflow-auto p-2">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="panel h-32 animate-pulse bg-[rgba(0,240,255,0.02)]" />
          ))}
        </div>
      </div>
    );
  }

  const winCount = data?.outcomes?.wins || 0;
  const lossCount = data?.outcomes?.losses || 0;
  const decided = winCount + lossCount;
  const winRate = decided > 0 ? Math.round((winCount / decided) * 100) : 0;

  return (
    <div className="flex-1 overflow-auto p-2">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 stagger-cards" style={{ gridTemplateRows: "auto 1fr 1fr" }}>

        {/* Row 1: Stat Strip */}
        <div className="col-span-full panel">
          <div className="panel-header">PORTFOLIO OVERVIEW</div>
          <div className="flex items-center gap-6 p-3 flex-wrap">
            <StatBlock label="Win / Loss" value={`${winCount}W ${lossCount}L`} sub={`${winRate}% win rate`} />
            <StatBlock label="Signals" value={String(data?.totalInsights || 0)} color="neon-text" />
            <StatBlock label="Training Data" value={(data?.trainingStats?.trades || 0).toLocaleString()} sub={`${(data?.trainingStats?.observations || 0).toLocaleString()} obs`} />
            <StatBlock label="XP" value={String(data?.xp || 0)} sub={data?.rank || "Intern Quant"} color="neon-text" />
            <StatBlock label="Cost Today" value={`$${(data?.todayCost || 0).toFixed(3)}`} sub="/ $0.250 budget" />
            <StatBlock label="DB Size" value={`${data?.dbSizeMB || 0} MB`} />
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
                {s.outcome?.toLowerCase() === "win" && <CheckCircle className="h-3 w-3 text-[var(--neon-green)]" />}
                {s.outcome?.toLowerCase() === "loss" && <XCircle className="h-3 w-3 text-[var(--neon-red)]" />}
                {(!s.outcome || !["win", "loss"].includes(s.outcome.toLowerCase())) && <Clock className="h-3 w-3 text-muted-foreground" />}
              </div>
            ))}
            {(!data?.recentSignals || data.recentSignals.length === 0) && (
              <div className="flex flex-col items-center justify-center py-6 text-muted-foreground gap-1">
                <Activity className="h-5 w-5 opacity-20" />
                <span className="text-[10px]">No signals yet</span>
              </div>
            )}
          </div>
        </Panel>

        {/* Panel: Watchlist */}
        <Panel title="WATCHLIST" className="row-span-1">
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
                  {w.mode === "scalp" ? "SCALP" : "LT"}
                </span>
                <span className="text-[9px] text-muted-foreground flex-1">{w.asset_type}</span>
              </div>
            ))}
            {(!data?.watchlist || data.watchlist.length === 0) && (
              <div className="text-[10px] text-muted-foreground text-center py-4">No watchlist items</div>
            )}
          </div>
        </Panel>

        {/* Panel: System Log */}
        <Panel title="SYSTEM LOG" className="row-span-1">
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
    </div>
  );
}
