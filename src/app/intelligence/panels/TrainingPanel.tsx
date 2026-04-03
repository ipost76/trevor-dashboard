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

type V3TickerInfo = { ticker: string; count: number; win_rate: number };
type V3RegimeInfo = { regime: string; count: number; win_rate: number };
type V3SeverityInfo = { severity: string; count: number; avg_survival_rate: number };
type V3Pipeline = {
  exit_patterns: { total: number; by_ticker: V3TickerInfo[]; by_regime: V3RegimeInfo[]; by_method: Record<string, number> };
  regime_transitions: { total: number; by_severity: V3SeverityInfo[] };
  learned_outcomes: { total: number };
};
type ConnectionStatus = {
  signal_generation: { wired: boolean; queries_24h: number };
  position_sentinel: { wired: boolean; queries_24h: number; threshold_shifts_24h: number };
  exit_engine: { wired: boolean; queries_24h: number };
  autotrader: { wired: boolean; note: string };
  last_training_context: string | null;
};
type VMHealth = { mem_used_gb: number; mem_total_gb: number; disk_used_gb: number; disk_total_gb: number };

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
  v3_pipeline?: V3Pipeline;
  connection_status?: ConnectionStatus;
  vm_health?: VMHealth;
  nightly_learner?: { timer_active: boolean };
  generator_status?: { exit_patterns: string; regime_transitions: string };
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
export default function TrainingPanel() {
  const [data, setData] = useState<TrainingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [storageExpanded, setStorageExpanded] = useState(false);

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

      {/* ── Key Insights Card ── */}
      {data.totalRecords > 0 && (() => {
        const insights: string[] = [];
        const longDir = data.byDirection?.find((d: { direction: string; winRate: number }) => d.direction === "LONG");
        const shortDir = data.byDirection?.find((d: { direction: string; winRate: number }) => d.direction === "SHORT");
        if (longDir && shortDir) {
          if (shortDir.winRate > longDir.winRate) insights.push(`SHORT > LONG: ${shortDir.winRate}% vs ${longDir.winRate}% WR`);
          else insights.push(`LONG > SHORT: ${longDir.winRate}% vs ${shortDir.winRate}% WR`);
        }
        if (data.topTickers?.[0]) {
          const t = data.topTickers[0];
          const pct = data.totalRecords > 0 ? Math.round(t.count / data.totalRecords * 100) : 0;
          insights.push(`Top ticker: ${t.ticker} (${t.winRate}% WR, ${pct}% coverage)`);
        }
        const severe = data.v3_pipeline?.regime_transitions?.by_severity?.find((s: { severity: string; avg_survival_rate: number }) => s.severity === "SEVERE");
        if (severe) insights.push(`SEVERE regime shifts: ${severe.avg_survival_rate}% survival`);
        if (data.v3_pipeline?.exit_patterns?.total && data.v3_pipeline.exit_patterns.total > 0) insights.push(`${data.v3_pipeline.exit_patterns.total.toLocaleString()} exit pattern scenarios`);
        insights.push(`${fmtK(data.totalRecords)} training records analyzed`);
        if (insights.length === 0) return null;
        return (
          <div className="panel p-4" style={{ borderLeft: "3px solid #00ff88", borderColor: "rgba(0,255,136,0.25)" }}>
            <div className="text-[12px] font-bold font-mono neon-green tracking-wider mb-2.5">💡 KEY INSIGHTS</div>
            <div className="space-y-1">
              {insights.map((ins, i) => (
                <div key={i} className="flex items-baseline gap-2 text-[12px] font-mono text-foreground">
                  <span className="neon-green shrink-0">▸</span>
                  <span>{ins}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── V3 Pipeline Status ── */}
      {data.v3_pipeline && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {[
              { label: "EXIT PATTERNS", total: data.v3_pipeline.exit_patterns.total, gen: data.generator_status?.exit_patterns },
              { label: "REGIME TRANSITIONS", total: data.v3_pipeline.regime_transitions.total, gen: data.generator_status?.regime_transitions },
              { label: "LEARNED OUTCOMES", total: data.v3_pipeline.learned_outcomes.total, gen: undefined },
            ].map(item => {
              const status = item.total > 0 ? "complete" : item.gen === "generating" ? "generating" : item.total === 0 ? "awaiting" : item.total === -1 ? "missing" : "failed";
              const icon = status === "complete" ? "✅" : status === "generating" ? "🔄" : status === "awaiting" ? "⏳" : status === "missing" ? "—" : "❌";
              const color = status === "complete" ? "neon-green" : status === "generating" ? "neon-text" : status === "awaiting" ? "neon-amber" : "text-muted-foreground";
              return (
                <div key={item.label} className="panel p-3 text-center">
                  <div className="stat-label mb-1">{item.label}</div>
                  <div className={cn("stat-value text-lg", color)}>
                    {icon} {status === "complete" ? fmtK(item.total) : status === "generating" ? "Generating..." : status === "awaiting" ? "Awaiting data" : status === "missing" ? "Not configured" : "Failed"}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-4 px-2 text-[10px]">
            <span>
              🌙 Nightly Learner:{" "}
              <span className={data.nightly_learner?.timer_active ? "neon-green font-bold" : "neon-amber font-bold"}>
                {data.nightly_learner?.timer_active ? "Active" : "Inactive"}
              </span>
            </span>
            <span>
              📚 Soft Influence:{" "}
              <span className="neon-green font-bold">Wired</span>
            </span>
          </div>
        </div>
      )}

      {/* ── Connection Status ── */}
      {data.connection_status && (
        <div className="panel">
          <div className="panel-header">CONNECTION STATUS</div>
          <div className="p-3 space-y-1.5">
            {[
              { name: "SIGNAL GENERATION", ...data.connection_status.signal_generation, extra: null },
              { name: "POSITION SENTINEL", ...data.connection_status.position_sentinel, extra: data.connection_status.position_sentinel.threshold_shifts_24h > 0 ? `${data.connection_status.position_sentinel.threshold_shifts_24h} threshold shifts` : null },
              { name: "EXIT ENGINE", ...data.connection_status.exit_engine, extra: null },
              { name: "AUTOTRADER", wired: false, queries_24h: 0, extra: "Log-only — does not influence trades" },
            ].map(c => {
              const isAutotrader = c.name === "AUTOTRADER";
              const dotColor = isAutotrader ? "text-muted-foreground" : c.wired && c.queries_24h > 0 ? "neon-green" : c.wired ? "neon-amber" : "neon-red";
              const label = isAutotrader ? "LOG ONLY" : c.wired && c.queries_24h > 0 ? "CONNECTED" : c.wired ? "WIRED (no recent queries)" : "NOT CONNECTED";
              return (
                <div key={c.name} className="flex items-center gap-3 text-[10px]">
                  <span className={cn("text-lg leading-none", dotColor)}>{isAutotrader ? "○" : "●"}</span>
                  <span className="w-36 md:w-40 font-bold text-foreground shrink-0">{c.name}</span>
                  <span className={cn("font-bold", dotColor)}>{label}</span>
                  {!isAutotrader && c.queries_24h > 0 && (
                    <span className="text-muted-foreground font-mono">{c.queries_24h} queries</span>
                  )}
                  {c.extra && <span className="text-muted-foreground">{c.extra}</span>}
                </div>
              );
            })}
            {data.connection_status.last_training_context && (
              <div className="text-[9px] text-muted-foreground pt-1 border-t border-[var(--border)] mt-1.5">
                Last training context: <span className="font-mono text-foreground">{data.connection_status.last_training_context}</span>
              </div>
            )}
          </div>
        </div>
      )}

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
            {data.v3_pipeline && data.v3_pipeline.exit_patterns.total > 0 && (
              <>
                <p><span className="text-foreground font-bold">🎯 Exit Intelligence</span> — Queries {fmtK(data.v3_pipeline.exit_patterns.total)} historical exit scenarios to find the optimal exit method for current setups.</p>
                <p><span className="text-foreground font-bold">⚡ Regime Awareness</span> — Checks {fmtK(data.v3_pipeline.regime_transitions.total)} historical transitions to estimate position survival probability during regime shifts.</p>
              </>
            )}
            <p><span className="text-foreground font-bold">🌙 Continuous Learning</span> — Every night at 2am ET, processes closed trades and feeds optimal exit data back into memory.</p>
            <p><span className="text-foreground font-bold">🔌 Soft Influence</span> — Training data can make alerts MORE sensitive (1 group earlier) when reversal probability is high. Never makes alerts LESS sensitive. Never auto-closes.</p>
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

      {/* ── Exit Pattern Intelligence ── */}
      {data.v3_pipeline && data.v3_pipeline.exit_patterns.total > 0 && (() => {
        const ep = data.v3_pipeline!.exit_patterns;
        const maxMethod = Math.max(1, ...Object.values(ep.by_method));
        const totalMethods = Object.values(ep.by_method).reduce((a, b) => a + b, 0) || 1;
        const maxEpTicker = Math.max(1, ...ep.by_ticker.map(t => t.count));
        return (
          <div className="panel">
            <div className="panel-header">🎯 EXIT PATTERN INTELLIGENCE</div>
            <div className="p-3 space-y-3">
              <div className="text-[11px] text-muted-foreground">Total Scenarios: <span className="text-foreground font-bold font-mono">{fmtK(ep.total)}</span></div>
              <div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">BY EXIT METHOD</div>
                <div className="space-y-1.5">
                  {Object.entries(ep.by_method).map(([method, count]) => (
                    <div key={method} className="flex items-center gap-3">
                      <span className="w-20 text-[10px] font-bold text-foreground shrink-0 capitalize">{method}</span>
                      <ProgressBar value={count} max={maxMethod} />
                      <span className="w-14 text-[10px] text-muted-foreground font-mono shrink-0 text-right">{fmtK(count)}</span>
                      <span className="w-10 text-[10px] text-muted-foreground font-mono shrink-0 text-right">{((count / totalMethods) * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">TOP TICKERS</div>
                <div className="space-y-1">
                  {ep.by_ticker.slice(0, 8).map(t => (
                    <div key={t.ticker} className="flex items-center gap-2 px-1 text-[10px]">
                      <span className="w-16 font-bold text-foreground">{t.ticker}</span>
                      <ProgressBar value={t.count} max={maxEpTicker} />
                      <span className="w-12 text-muted-foreground font-mono text-right">{fmtK(t.count)}</span>
                      <span className={cn("w-12 font-bold font-mono text-right", wrColor(t.win_rate))}>{t.win_rate}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Regime Transition Map ── */}
      {data.v3_pipeline && data.v3_pipeline.regime_transitions.total > 0 && (() => {
        const rt = data.v3_pipeline!.regime_transitions;
        const maxSev = Math.max(1, ...rt.by_severity.map(s => s.count));
        return (
          <div className="panel">
            <div className="panel-header">⚡ REGIME TRANSITION MAP</div>
            <div className="p-3 space-y-2">
              <div className="text-[11px] text-muted-foreground">Total Transitions: <span className="text-foreground font-bold font-mono">{fmtK(rt.total)}</span></div>
              <div className="space-y-1.5">
                {rt.by_severity.map(s => {
                  const survColor = (s.avg_survival_rate || 0) > 60 ? "neon-green" : (s.avg_survival_rate || 0) >= 30 ? "neon-amber" : "neon-red";
                  return (
                    <div key={s.severity} className="flex items-center gap-3">
                      <span className="w-16 text-[10px] font-bold text-foreground uppercase shrink-0">{s.severity}</span>
                      <span className="w-10 text-[10px] text-muted-foreground font-mono text-right shrink-0">{fmtK(s.count)}</span>
                      <span className={cn("w-20 text-[10px] font-bold font-mono text-right shrink-0", survColor)}>Surv: {s.avg_survival_rate || 0}%</span>
                      <ProgressBar value={s.count} max={maxSev} color={(s.avg_survival_rate || 0) > 60 ? "var(--neon-green)" : (s.avg_survival_rate || 0) >= 30 ? "var(--neon-amber)" : "var(--neon-red)"} />
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground pt-1">When TREVOR detects a regime change, it checks this data to estimate whether your position will survive the transition.</p>
            </div>
          </div>
        );
      })()}

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

      {/* ── Storage Breakdown (collapsible) ── */}
      <div className="panel">
        <button
          onClick={() => setStorageExpanded(!storageExpanded)}
          className="w-full panel-header flex items-center gap-1.5 cursor-pointer hover:bg-[rgba(0,240,255,0.03)] transition-colors"
        >
          <span>📦 STORAGE: {fmtK(data.byTable.reduce((a, t) => a + t.count, 0))} SQLite rows · {fmtK(data.chromaStats?.totalDocuments || 0)} vectors</span>
          <span className={cn("ml-auto text-muted-foreground transition-transform duration-200 text-[10px]", storageExpanded && "rotate-90")}>▸</span>
        </button>
        {storageExpanded && (
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

            {/* VM Health */}
            {data.vm_health && data.vm_health.mem_total_gb > 0 && (
              <div className="pt-2 border-t border-[var(--border)]">
                <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">💻 VM Health</div>
                {[
                  { label: "Memory", used: data.vm_health.mem_used_gb, total: data.vm_health.mem_total_gb, warnPct: 60, critPct: 80 },
                  { label: "Disk", used: data.vm_health.disk_used_gb, total: data.vm_health.disk_total_gb, warnPct: 70, critPct: 85 },
                ].map(h => {
                  const pct = h.total > 0 ? Math.round((h.used / h.total) * 100) : 0;
                  const barColor = pct >= h.critPct ? "var(--neon-red)" : pct >= h.warnPct ? "var(--neon-amber)" : "var(--neon-green)";
                  return (
                    <div key={h.label} className="flex items-center gap-2 text-[10px] mb-1">
                      <span className="w-14 text-muted-foreground shrink-0">{h.label}</span>
                      <span className="w-24 font-mono text-foreground shrink-0">{h.used}GB / {h.total}GB</span>
                      <ProgressBar value={h.used} max={h.total} color={barColor} />
                      <span className="w-10 font-mono text-muted-foreground text-right shrink-0">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
