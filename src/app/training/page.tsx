"use client";

import { useState, useCallback } from "react";
import { Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { usePolling } from "@/lib/use-polling";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

const COLORS = ["#00ff88", "#00d4ff", "#ffa502", "#ff4757", "#ff00ff", "#a855f7", "#38bdf8", "#4ade80", "#facc15", "#f87171"];

type TrainingStats = {
  totalRecords: number;
  winRate: number;
  avgConfidence: number;
  distinctTickers: number;
  outcomes: Record<string, number>;
  topTickers: Array<{ ticker: string; count: number; wins: number; losses: number; winRate: number }>;
  strategyBreakdown: Array<{ strategy: string; count: number; wins: number; losses: number; winRate: number }>;
  timeframes: Array<{ timeframe: string; count: number }>;
  dateRange: { earliest: string | null; latest: string | null };
  byTable: Array<{ table: string; count: number }>;
  error?: string;
};

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="panel p-3">
      <div className="stat-label">{label}</div>
      <div className={cn("stat-value mt-1", color || "text-foreground")}>{value}</div>
      {sub && <div className="text-[9px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel flex flex-col">
      <div className="panel-header">{title}</div>
      <div className="flex-1 p-2 min-h-[250px]">{children}</div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#12131a] border border-[#1e2030] rounded px-2 py-1 text-[10px] font-mono">
      <div className="text-[var(--foreground)] font-bold">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="text-muted-foreground">{p.name}: {typeof p.value === "number" ? p.value.toLocaleString() : p.value}</div>
      ))}
    </div>
  );
};

export default function TrainingPage() {
  const [data, setData] = useState<TrainingStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    const d = await safeFetch<Partial<TrainingStats>>("/api/training?scope=summary", {});
    if (d.totalRecords !== undefined) setData(d as TrainingStats);
    setLoading(false);
  }, []);

  usePolling(fetchStats, 300000); // refresh every 5 min (heavy query)

  if (loading) {
    return (
      <div className="flex-1 overflow-auto p-2 space-y-2">
        <div className="h-8 w-48 rounded bg-[rgba(0,255,136,0.03)] animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="panel h-20 animate-pulse bg-[rgba(0,255,136,0.02)]" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="panel h-64 animate-pulse bg-[rgba(0,255,136,0.02)]" />
          ))}
        </div>
      </div>
    );
  }

  if (!data || data.error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Database className="h-6 w-6 opacity-20" />
          <span className="text-[11px]">Training data unavailable</span>
          {data?.error && <span className="text-[9px] opacity-50 max-w-xs text-center">{data.error.slice(0, 100)}</span>}
        </div>
      </div>
    );
  }

  const wins = data.outcomes?.WIN || 0;
  const losses = data.outcomes?.LOSS || 0;
  const scratches = data.outcomes?.SCRATCH || 0;
  const decided = wins + losses;
  const longCount = data.topTickers?.reduce((a, t) => a, 0) || 0; // direction data from audit
  const signalTypeCount = data.strategyBreakdown?.length || 0;

  // Format date range
  const earliest = data.dateRange?.earliest ? new Date(data.dateRange.earliest).getFullYear() : "?";
  const latest = data.dateRange?.latest ? new Date(data.dateRange.latest).getFullYear() : "?";

  // Win rate color
  const wrColor = data.winRate >= 50 ? "neon-green" : data.winRate >= 40 ? "neon-amber" : "neon-red";

  // Prepare chart data
  const tickerChartData = (data.topTickers || []).map(t => ({
    ticker: t.ticker,
    winRate: t.winRate,
    total: t.count,
    fill: t.winRate >= 50 ? "#00ff88" : t.winRate >= 40 ? "#ffa502" : "#ff4757",
  }));

  const signalTypeData = (data.strategyBreakdown || []).map((s, i) => ({
    name: s.strategy,
    value: s.count,
    fill: COLORS[i % COLORS.length],
  }));

  const regimeData = (data.timeframes || []).map((t, i) => ({
    name: t.timeframe,
    value: t.count,
    fill: COLORS[i % COLORS.length],
  }));

  const outcomeData = [
    { name: "WIN", value: wins, fill: "#00ff88" },
    { name: "LOSS", value: losses, fill: "#ff4757" },
    { name: "SCRATCH", value: scratches, fill: "#ffa502" },
  ];

  return (
    <div className="flex-1 overflow-auto p-2 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-bold tracking-[0.15em] uppercase" style={{ fontFamily: "var(--font-display)" }}>
          Training Data
        </h1>
        <div className="flex items-center gap-1.5 rounded bg-[rgba(0,255,136,0.05)] border border-[rgba(0,255,136,0.15)] px-2 py-0.5">
          <Database className="h-2.5 w-2.5 text-[var(--neon-green)]" />
          <span className="text-[10px] font-bold text-[var(--neon-green)]">{data.totalRecords.toLocaleString()} records</span>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <StatCard label="Total Records" value={data.totalRecords.toLocaleString()} color="neon-text" />
        <StatCard label="Win Rate" value={`${data.winRate}%`} sub={`${wins.toLocaleString()}W / ${losses.toLocaleString()}L`} color={wrColor} />
        <StatCard label="Unique Tickers" value={String(data.distinctTickers)} />
        <StatCard label="Signal Types" value={String(signalTypeCount)} />
        <StatCard label="Outcomes" value={`${wins.toLocaleString()}W`} sub={`${losses.toLocaleString()}L / ${scratches.toLocaleString()}S`} />
        <StatCard label="Date Range" value={`${earliest}–${latest}`} sub={data.dateRange?.earliest?.slice(0, 10) || ""} />
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {/* Chart 1: Win Rate by Ticker */}
        <ChartPanel title="WIN RATE BY TICKER (TOP 20)">
          <ResponsiveContainer width="100%" height={Math.max(250, tickerChartData.length * 22)}>
            <BarChart data={tickerChartData} layout="vertical" margin={{ left: 50, right: 20, top: 5, bottom: 5 }}>
              <XAxis type="number" domain={[0, 100]} tick={{ fill: "#8888a0", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "#1e2030" }} />
              <YAxis type="category" dataKey="ticker" tick={{ fill: "#e8e8f0", fontSize: 10, fontFamily: "var(--font-mono)" }} width={48} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="winRate" name="Win %" radius={[0, 2, 2, 0]} barSize={14}>
                {tickerChartData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} fillOpacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        {/* Chart 2: Signal Type Distribution */}
        <ChartPanel title="SIGNAL TYPE DISTRIBUTION">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={signalTypeData} cx="50%" cy="45%" innerRadius={50} outerRadius={80} dataKey="value" nameKey="name" stroke="#0a0a0f" strokeWidth={2}>
                {signalTypeData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0];
                return (
                  <div className="bg-[#12131a] border border-[#1e2030] rounded px-2 py-1 text-[10px] font-mono">
                    <div className="text-foreground font-bold">{String(d.name)}</div>
                    <div className="text-muted-foreground">{Number(d.value).toLocaleString()} trades</div>
                  </div>
                );
              }} />
              <Legend
                verticalAlign="bottom"
                height={60}
                formatter={(value: string) => <span className="text-[9px] text-muted-foreground">{value}</span>}
                wrapperStyle={{ fontSize: 9 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartPanel>

        {/* Chart 3: Outcome Distribution */}
        <ChartPanel title="OUTCOME DISTRIBUTION">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={outcomeData} cx="50%" cy="45%" innerRadius={50} outerRadius={80} dataKey="value" nameKey="name" stroke="#0a0a0f" strokeWidth={2}>
                {outcomeData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0];
                return (
                  <div className="bg-[#12131a] border border-[#1e2030] rounded px-2 py-1 text-[10px] font-mono">
                    <div className="text-foreground font-bold">{String(d.name)}</div>
                    <div className="text-muted-foreground">{Number(d.value).toLocaleString()} ({decided > 0 ? ((Number(d.value) / data.totalRecords) * 100).toFixed(1) : 0}%)</div>
                  </div>
                );
              }} />
              <Legend
                verticalAlign="bottom"
                height={36}
                formatter={(value: string) => <span className="text-[9px] text-muted-foreground">{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartPanel>

        {/* Chart 4: Timeframe Distribution */}
        <ChartPanel title="TIMEFRAME DISTRIBUTION">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={regimeData} margin={{ left: 10, right: 10, top: 10, bottom: 5 }}>
              <XAxis dataKey="name" tick={{ fill: "#8888a0", fontSize: 9 }} tickLine={false} axisLine={{ stroke: "#1e2030" }} />
              <YAxis tick={{ fill: "#8888a0", fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" name="Trades" radius={[2, 2, 0, 0]} barSize={28}>
                {regimeData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>

      {/* Strategy Breakdown Table */}
      {data.strategyBreakdown && data.strategyBreakdown.length > 0 && (
        <div className="panel">
          <div className="panel-header">SIGNAL TYPE PERFORMANCE</div>
          <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--border)] text-[8px] font-bold uppercase tracking-[0.1em] text-muted-foreground bg-[var(--panel-header)]">
            <span className="flex-1">Signal Type</span>
            <span className="w-20 text-right">Count</span>
            <span className="w-14 text-right">Wins</span>
            <span className="w-14 text-right">Losses</span>
            <span className="w-16 text-right">Win Rate</span>
            <span className="w-32 hidden md:block">Distribution</span>
          </div>
          {data.strategyBreakdown.map((s, i) => {
            const maxCount = data.strategyBreakdown[0]?.count || 1;
            return (
              <div key={s.strategy} className={cn("flex items-center gap-2 data-cell", i % 2 === 0 ? "bg-[#0e0f18]" : "bg-[#12131a]")}>
                <span className="flex-1 font-bold text-[11px] truncate">{s.strategy}</span>
                <span className="w-20 text-right font-mono text-muted-foreground">{s.count.toLocaleString()}</span>
                <span className="w-14 text-right font-mono neon-green">{s.wins.toLocaleString()}</span>
                <span className="w-14 text-right font-mono neon-red">{s.losses.toLocaleString()}</span>
                <span className={cn("w-16 text-right font-mono font-bold", s.winRate >= 50 ? "neon-green" : s.winRate >= 40 ? "neon-amber" : "neon-red")}>
                  {s.winRate}%
                </span>
                <div className="w-32 hidden md:block">
                  <div className="h-1.5 rounded-full bg-[rgba(255,255,255,0.04)]">
                    <div className="h-full rounded-full bg-[var(--neon-cyan)] opacity-50" style={{ width: `${(s.count / maxCount) * 100}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
