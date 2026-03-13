"use client";
import { useEffect, useState, useCallback } from "react";
import { RefreshCw, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";

type Overall = {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null;
};

type CalBucket = {
  trades: number;
  wins: number;
  winRate: number | null;
};

type TickerPerf = {
  symbol: string;
  trades: number;
  wins: number;
  winRate: number;
  totalPnl: number;
};

type SQData = {
  overall: Overall;
  calibration: Record<string, CalBucket>;
  tickerPerformance: TickerPerf[];
};

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="panel p-3 text-center">
      <div className="stat-label mb-1">{label}</div>
      <div className={cn("stat-value", color || "text-foreground")}>{value}</div>
      {sub && <div className="text-[9px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

export default function SignalQualityPage() {
  const [data, setData] = useState<SQData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<"trades" | "winRate" | "totalPnl">("trades");
  const [sortAsc, setSortAsc] = useState(false);

  const fetchData = useCallback(async () => {
    const raw = await safeFetch<SQData | null>("/api/signal-quality", null);
    if (raw) setData(raw);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <RefreshCw className="h-5 w-5 animate-spin text-[var(--neon-cyan)]" />
      </div>
    );
  }

  const overall = data?.overall;
  if (!overall || overall.totalTrades === 0) {
    return (
      <div className="flex-1 overflow-auto p-3">
        <div className="panel-header mb-3">SIGNAL QUALITY</div>
        <div className="panel p-6 text-center">
          <div className="text-muted-foreground text-sm">No trade data yet. Take some trades and check back!</div>
        </div>
      </div>
    );
  }

  const cal = data?.calibration || {};
  const bucketOrder = ["50-60", "60-70", "70-80", "80-90", "90+"];
  const maxBucketTrades = Math.max(1, ...bucketOrder.map(k => cal[k]?.trades || 0));

  const sortedTickers = [...(data?.tickerPerformance || [])].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const wrColor = (wr: number) => wr >= 55 ? "neon-green" : wr < 45 ? "neon-red" : "neon-amber";

  return (
    <div className="flex-1 overflow-auto p-3">
      <div className="panel-header mb-3">SIGNAL QUALITY</div>

      {/* Overall Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4 stagger-cards">
        <StatCard label="TOTAL TRADES" value={String(overall.totalTrades)} />
        <StatCard label="WIN RATE" value={`${overall.winRate}%`} color={wrColor(overall.winRate)} />
        <StatCard label="TOTAL P&L" value={`${overall.totalPnl >= 0 ? "+" : ""}${overall.totalPnl}%`} color={overall.totalPnl >= 0 ? "neon-green" : "neon-red"} />
        <StatCard label="PROFIT FACTOR" value={overall.profitFactor != null ? String(overall.profitFactor) : "N/A"} color="neon-text" />
        <StatCard label="AVG WIN" value={`+${overall.avgWin}%`} color="neon-green" />
        <StatCard label="AVG LOSS" value={`${overall.avgLoss}%`} color="neon-red" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Calibration */}
        <div className="panel">
          <div className="panel-header">CONFIDENCE CALIBRATION</div>
          <div className="p-3 space-y-2">
            {bucketOrder.map(bucket => {
              const b = cal[bucket];
              if (!b) return null;
              const midpoint = bucket === "90+" ? 92.5 : (parseInt(bucket) + parseInt(bucket.split("-")[1] || "100")) / 2;
              const wr = b.winRate;
              const calibrated = wr != null && wr >= midpoint;
              const barWidth = b.trades > 0 ? (b.trades / maxBucketTrades) * 100 : 0;
              return (
                <div key={bucket} className="flex items-center gap-3">
                  <span className="text-[10px] font-bold text-muted-foreground w-10 shrink-0">{bucket}%</span>
                  <div className="flex-1">
                    <div className="h-4 rounded-sm bg-[var(--muted)] relative overflow-hidden">
                      <div
                        className="h-full rounded-sm transition-all"
                        style={{
                          width: `${barWidth}%`,
                          backgroundColor: b.trades === 0 ? "var(--muted-foreground)" : calibrated ? "var(--neon-green)" : "var(--neon-red)",
                          opacity: b.trades === 0 ? 0.2 : 0.7,
                        }}
                      />
                    </div>
                  </div>
                  <div className="text-right w-20 shrink-0">
                    {b.trades > 0 ? (
                      <span className={cn("text-[10px] font-bold", calibrated ? "neon-green" : "neon-red")}>
                        {wr}% <span className="text-muted-foreground font-normal">({b.trades})</span>
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">No data</span>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="text-[9px] text-muted-foreground mt-2 pt-2 border-t border-[var(--border)]">
              Green = actual win rate ≥ expected (bucket midpoint). Red = below expected.
            </div>
          </div>
        </div>

        {/* Ticker Performance */}
        <div className="panel">
          <div className="panel-header">TICKER PERFORMANCE</div>
          <div className="overflow-auto max-h-[400px]">
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="text-muted-foreground text-[9px] uppercase tracking-wider">
                  <th className="text-left p-2">Ticker</th>
                  <th className="text-right p-2 cursor-pointer hover:text-foreground" onClick={() => handleSort("trades")}>
                    Trades {sortKey === "trades" && (sortAsc ? "▲" : "▼")}
                  </th>
                  <th className="text-right p-2 cursor-pointer hover:text-foreground" onClick={() => handleSort("winRate")}>
                    Win Rate {sortKey === "winRate" && (sortAsc ? "▲" : "▼")}
                  </th>
                  <th className="text-right p-2 cursor-pointer hover:text-foreground" onClick={() => handleSort("totalPnl")}>
                    P&L {sortKey === "totalPnl" && (sortAsc ? "▲" : "▼")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedTickers.map(t => (
                  <tr key={t.symbol} className="border-b border-[rgba(0,240,255,0.06)] hover:bg-[rgba(0,240,255,0.03)]">
                    <td className="p-2 font-bold text-foreground">{t.symbol}</td>
                    <td className="p-2 text-right text-muted-foreground">{t.trades}</td>
                    <td className={cn("p-2 text-right font-bold", wrColor(t.winRate))}>
                      {t.winRate}%
                    </td>
                    <td className="p-2 text-right">
                      <span className={cn("font-bold", t.totalPnl >= 0 ? "neon-green" : "neon-red")}>
                        {t.totalPnl >= 0 ? "+" : ""}{t.totalPnl}%
                      </span>
                    </td>
                  </tr>
                ))}
                {sortedTickers.length === 0 && (
                  <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">No ticker data</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
