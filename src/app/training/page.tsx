"use client";

import { useEffect, useState, useCallback } from "react";
import { Database, RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { Skeleton } from "@/components/ui/skeleton";

/* ── Types ── */
type TableInfo = { table: string; count: number };
type TickerInfo = { ticker: string; count: number; wins: number; losses: number; winRate: number };
type StratInfo = { strategy: string; count: number; wins: number; losses: number; winRate: number };
type TfInfo = { timeframe: string; count: number };
type DirInfo = { direction: string; count: number; wins: number; winRate: number };
type RegimeInfo = { regime: string; count: number; wins: number; winRate: number };
type ChromaCol = { name: string; trainingDocs: number };

type TrainingData = {
  byTable: TableInfo[];
  totalRecords: number;
  outcomes: Record<string, number>;
  winRate: number;
  avgConfidence: number;
  topTickers: TickerInfo[];
  strategyBreakdown: StratInfo[];
  timeframes: TfInfo[];
  byDirection: DirInfo[];
  byRegime: RegimeInfo[];
  dateRange: { earliest: string | null; latest: string | null };
  distinctTickers: number;
  chromaStats: { collections: ChromaCol[]; totalDocuments: number; error?: string };
};

/* ── Helpers ── */
const fmtK = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
};
const wrColor = (wr: number) => wr >= 50 ? "neon-green" : wr < 40 ? "neon-red" : "neon-amber";

/* ── Progress Bar component ── */
function ProgressBar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex-1 h-2 rounded-full bg-[var(--muted)] overflow-hidden">
      <div className="h-full rounded-full transition-all opacity-70" style={{ width: `${pct}%`, backgroundColor: color || "var(--neon-cyan)" }} />
    </div>
  );
}

/* ── Page ── */
export default function TrainingPage() {
  const [data, setData] = useState<TrainingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), 5000);
    const d = await safeFetch<TrainingData | null>("/api/training?scope=summary", null);
    clearTimeout(timer);
    setData(d);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-[var(--neon-cyan)]" />
          <span className="text-sm font-bold tracking-wider uppercase neon-text">Training Data</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
        {slow && (
          <div className="flex items-center gap-2 panel p-3 border-[var(--neon-amber)]">
            <AlertTriangle className="h-3.5 w-3.5 text-[var(--neon-amber)]" />
            <span className="text-[10px] text-[var(--neon-amber)]">Loading training data (cold start can take 15-30s)...</span>
          </div>
        )}
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <Database className="h-8 w-8 text-muted-foreground mx-auto" />
          <div className="text-sm text-muted-foreground">Failed to load training data</div>
          <button onClick={fetchData} className="btn-primary text-[10px]">Retry</button>
        </div>
      </div>
    );
  }

  const totalTT = data.byTable?.find(t => t.table === "training_trades")?.count || 0;
  const maxTf = Math.max(1, ...data.timeframes.map(t => t.count));
  const maxRegime = Math.max(1, ...data.byRegime.map(r => r.count));
  const maxTicker = Math.max(1, ...(data.topTickers || []).slice(0, 10).map(t => t.count));

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-3">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-[var(--neon-cyan)]" />
          <h1 className="text-sm font-bold tracking-wider uppercase neon-text">Training Data</h1>
          <span className="text-[10px] text-muted-foreground">Pattern recognition library</span>
        </div>
        <button onClick={fetchData} className="text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {/* ── Summary Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { label: "TOTAL RECORDS", value: fmtK(data.totalRecords), color: "neon-text" },
          { label: "WIN RATE", value: `${data.winRate}%`, color: wrColor(data.winRate) },
          { label: "TICKERS", value: String(data.distinctTickers), color: "neon-text" },
          { label: "CHROMADB", value: data.chromaStats?.totalDocuments > 0 ? fmtK(data.chromaStats.totalDocuments) + " vectors" : "—", color: "neon-text" },
        ].map(s => (
          <div key={s.label} className="panel p-3 text-center">
            <div className="stat-label mb-1">{s.label}</div>
            <div className={cn("stat-value text-lg md:text-xl", s.color)}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── How TREVOR Uses This Data ── */}
      <div className="panel">
        <div className="panel-header">HOW TREVOR USES THIS DATA</div>
        <div className="p-3 space-y-2.5 text-[11px] text-muted-foreground leading-relaxed">
          <p>TREVOR&apos;s training data is a synthetic library of historical trade patterns generated from walk-forward backtests across <strong className="text-foreground">{data.distinctTickers} tickers</strong> and <strong className="text-foreground">{data.timeframes.length} timeframes</strong>.</p>
          <div className="space-y-1.5">
            <p><span className="text-foreground font-bold">📊 Signal Scoring</span> — The confluence scanner queries training patterns to calibrate entry confidence. When a live signal fires, TREVOR checks: &ldquo;How did similar setups perform historically?&rdquo;</p>
            <p><span className="text-foreground font-bold">🧠 Memory & Learning</span> — Training vectors in ChromaDB provide semantic context during signal evaluation. The training bridge retrieves similar past patterns to inform real-time decisions.</p>
            <p><span className="text-foreground font-bold">🎯 Stop/Target Optimization</span> — Historical outcomes help calibrate stop loss distances and profit targets for different market regimes.</p>
            <p><span className="text-foreground font-bold">⚡ Regime Adaptation</span> — Training data spans trending, ranging, and volatile regimes, letting TREVOR adjust thresholds based on current conditions.</p>
          </div>
          <p className="text-[10px]">Data sources: Walk-forward backtests on {data.distinctTickers}+ tickers (BTC, ETH, SOL, DOGE, AVAX, LINK, and more) across {data.timeframes.length} timeframes ({data.timeframes.map(t => t.timeframe).join(", ")}).</p>
        </div>
      </div>

      {/* ── Timeframe Breakdown ── */}
      {data.timeframes.length > 0 && (
        <div className="panel">
          <div className="panel-header">BREAKDOWN BY TIMEFRAME</div>
          <div className="p-3 space-y-2">
            {data.timeframes.map(tf => {
              const pctOfTotal = totalTT > 0 ? ((tf.count / totalTT) * 100).toFixed(0) : "0";
              return (
                <div key={tf.timeframe} className="flex items-center gap-3">
                  <span className="w-10 text-[11px] font-bold neon-text shrink-0">{tf.timeframe}</span>
                  <span className="w-14 text-[10px] text-muted-foreground font-mono shrink-0 text-right">{fmtK(tf.count)}</span>
                  <ProgressBar value={tf.count} max={maxTf} />
                  <span className="w-10 text-[10px] text-muted-foreground font-mono shrink-0 text-right">{pctOfTotal}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Regime Breakdown ── */}
      {data.byRegime && data.byRegime.length > 0 && (
        <div className="panel">
          <div className="panel-header">BREAKDOWN BY REGIME</div>
          <div className="p-3 space-y-2">
            {data.byRegime.map(r => {
              const pctOfTotal = totalTT > 0 ? ((r.count / totalTT) * 100).toFixed(0) : "0";
              return (
                <div key={r.regime} className="flex items-center gap-3">
                  <span className="w-20 text-[10px] font-bold text-foreground shrink-0 truncate">{r.regime}</span>
                  <span className="w-14 text-[10px] text-muted-foreground font-mono shrink-0 text-right">{fmtK(r.count)}</span>
                  <ProgressBar value={r.count} max={maxRegime} color={r.winRate >= 45 ? "var(--neon-green)" : "var(--neon-red)"} />
                  <span className={cn("w-12 text-[10px] font-bold font-mono shrink-0 text-right", wrColor(r.winRate))}>{r.winRate}%</span>
                  <span className="w-10 text-[10px] text-muted-foreground font-mono shrink-0 text-right">{pctOfTotal}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Direction Split ── */}
      {data.byDirection && data.byDirection.length > 0 && (
        <div className="panel">
          <div className="panel-header">DIRECTION SPLIT</div>
          <div className="p-3">
            <div className="grid grid-cols-2 gap-3">
              {data.byDirection.map(d => (
                <div key={d.direction} className="panel p-3 text-center">
                  <div className={cn("text-lg font-bold font-mono", d.direction === "LONG" ? "neon-green" : d.direction === "SHORT" ? "neon-red" : "neon-text")}>{d.direction}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">{fmtK(d.count)} records</div>
                  <div className={cn("text-[11px] font-bold mt-0.5", wrColor(d.winRate))}>{d.winRate}% WR</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Top Tickers ── */}
      {data.topTickers && data.topTickers.length > 0 && (
        <div className="panel">
          <div className="panel-header">TOP TICKERS BY VOLUME</div>
          <div className="p-2 space-y-0">
            {data.topTickers.slice(0, 10).map(t => {
              const pctOfTotal = totalTT > 0 ? ((t.count / totalTT) * 100).toFixed(1) : "0";
              return (
                <div key={t.ticker} className="flex items-center gap-2 px-2 py-1.5 text-[10px] border-b border-[rgba(0,240,255,0.04)] hover:bg-[rgba(0,240,255,0.03)]">
                  <span className="w-20 font-bold text-foreground truncate">{t.ticker}</span>
                  <span className="w-14 text-right text-muted-foreground font-mono">{fmtK(t.count)}</span>
                  <ProgressBar value={t.count} max={maxTicker} />
                  <span className={cn("w-12 text-right font-bold font-mono", wrColor(t.winRate))}>{t.winRate}%</span>
                  <span className="w-12 text-right text-muted-foreground font-mono">{pctOfTotal}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Signal Types ── */}
      {data.strategyBreakdown && data.strategyBreakdown.length > 0 && (
        <div className="panel">
          <div className="panel-header">SIGNAL TYPE BREAKDOWN</div>
          <div className="p-2 space-y-0">
            {data.strategyBreakdown.slice(0, 10).map(s => {
              const maxStrat = data.strategyBreakdown[0]?.count || 1;
              return (
                <div key={s.strategy} className="flex items-center gap-2 px-2 py-1.5 text-[10px] border-b border-[rgba(0,240,255,0.04)] hover:bg-[rgba(0,240,255,0.03)]">
                  <span className="w-36 md:w-44 font-bold text-foreground truncate">{s.strategy}</span>
                  <ProgressBar value={s.count} max={maxStrat} />
                  <span className="w-14 text-right text-muted-foreground font-mono">{fmtK(s.count)}</span>
                  <span className={cn("w-10 text-right font-bold font-mono", wrColor(s.winRate))}>{s.winRate}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Storage Breakdown ── */}
      <div className="panel">
        <div className="panel-header">STORAGE BREAKDOWN</div>
        <div className="p-3 space-y-3">
          {/* SQLite Tables */}
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">SQLite Tables</div>
            <div className="space-y-1">
              {data.byTable.map(t => (
                <div key={t.table} className="flex items-center justify-between text-[10px] px-1">
                  <span className="text-foreground font-mono">{t.table}</span>
                  <span className="text-muted-foreground font-mono">{t.count.toLocaleString()} rows</span>
                </div>
              ))}
            </div>
          </div>

          {/* ChromaDB Collections */}
          {data.chromaStats?.collections?.length > 0 && (
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">ChromaDB Collections</div>
              <div className="space-y-1">
                {data.chromaStats.collections.map(c => (
                  <div key={c.name} className="flex items-center justify-between text-[10px] px-1">
                    <span className="text-foreground font-mono">{c.name}</span>
                    <span className="text-muted-foreground font-mono">{c.trainingDocs.toLocaleString()} vectors</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="text-[9px] text-muted-foreground px-1">
            All tagged: <span className="font-mono text-foreground">source=&apos;synthetic_training&apos;</span> — isolated from live trade data.
          </div>
        </div>
      </div>
    </div>
  );
}
