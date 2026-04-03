"use client";
import { useEffect, useState, useCallback } from "react";
import { Activity, RefreshCw, TrendingUp, TrendingDown, Target, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtPctSigned, fmtDollar } from "@/lib/format";
import { safeFetch } from "@/lib/fetch";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StyledBarChart } from "@/components/charts/StyledBarChart";
import { StyledLineChart } from "@/components/charts/StyledLineChart";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { CHART_COLORS } from "@/components/charts/theme";
import { CONF_DIST_COLORS, CAL_BUCKET_COLORS } from "@/components/charts/theme";

/* ── Types ── */
type Summary = {
  total_signals: number;
  signals_today: number;
  signals_this_week: number;
  avg_confidence: number;
  long_count: number;
  short_count: number;
  date_range: { first: string | null; latest: string | null };
};

type TickerRow = { ticker: string; total: number; long: number; short: number; avg_confidence: number };
type CalBucket = { trades: number; wins: number; winRate: number | null };
type TickerPerf = { symbol: string; trades: number; wins: number; winRate: number; totalPnl: number };
type Overall = {
  totalTrades: number; wins: number; losses: number; winRate: number;
  totalPnl: number; avgPnl: number; avgWin: number; avgLoss: number; profitFactor: number | null;
};
type DirDay = { date: string; long: number; short: number };
type DailyPnl = { date: string; pnl: number; cumulative: number; trades: number };

type TradePerformance = {
  total_closed: number; total_open: number;
  win_count: number; loss_count: number;
  win_rate: number; profit_factor: number | null;
  avg_winner_pct: number; avg_loser_pct: number;
  best_trade_pct: number; worst_trade_pct: number;
  total_pnl_pct: number | null; current_streak: number;
  capital: number | null;
  long_exposure_pct: number | null; short_exposure_pct: number | null;
};

type Expectancy = {
  per_trade_pct: number; avg_win: number; avg_loss: number;
  win_rate: number; breakeven_wr: number; interpretation: string;
};
type CircuitBreaker = {
  ticker: string; trades: number; wins: number; win_rate: number;
  status: string; threshold: number; cooldown_remaining_hours?: number;
};

type SignalData = {
  summary: Summary;
  by_ticker: TickerRow[];
  confidence_distribution: Record<string, number>;
  direction_over_time: DirDay[];
  quality: {
    overall: Overall | null;
    calibration: Record<string, CalBucket>;
    ticker_performance: TickerPerf[];
  };
  trade_performance: TradePerformance | null;
  expectancy: Expectancy | null;
  circuit_breakers: CircuitBreaker[];
};

const EMPTY_SUMMARY: Summary = {
  total_signals: 0, signals_today: 0, signals_this_week: 0, avg_confidence: 0,
  long_count: 0, short_count: 0, date_range: { first: null, latest: null },
};

/* ── Helpers ── */
const wrColor = (wr: number) => wr >= 55 ? "neon-green" : wr < 45 ? "neon-red" : "neon-amber";
const pfColor = (pf: number) => pf >= 1.5 ? "neon-green" : pf >= 1.0 ? "neon-amber" : "neon-red";
const pnlColor = (v: number) => v >= 0 ? "neon-green" : "neon-red";
const fmtK = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
const fmtPctLocal = (v: number) => `${fmtPctSigned(v)}%`;

const BUCKET_LABELS: Record<string, string> = {
  "35_44": "35-44%", "45_54": "45-54%", "55_64": "55-64%", "65_plus": "65%+",
};

/* ── Page ── */
export default function SignalsPanel() {
  const [data, setData] = useState<SignalData | null>(null);
  const [dailyPnl, setDailyPnl] = useState<DailyPnl[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCount, setFilterCount] = useState(0);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [sig, pnl] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      safeFetch<any>("/api/signals?scope=summary", null),
      safeFetch<DailyPnl[]>("/api/stats/daily-pnl", []),
    ]);
    if (sig) {
      setData(sig as SignalData);
    }
    setDailyPnl(pnl || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 30000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  useEffect(() => {
    fetch("/api/nav-badges").then(r => r.json()).then(d => setFilterCount(d.filterCount || 0)).catch(() => {});
  }, []);

  const summary = data?.summary ?? EMPTY_SUMMARY;
  const overall = data?.quality?.overall;
  const calibration = data?.quality?.calibration ?? {};
  const tickerPerf = data?.quality?.ticker_performance ?? [];
  const byTicker = data?.by_ticker ?? [];
  const expectancy = data?.expectancy;
  const circuitBreakers = data?.circuit_breakers ?? [];
  const confDist = data?.confidence_distribution ?? {};
  const dirTrend = data?.direction_over_time ?? [];
  const perf = data?.trade_performance;
  const totalSig = summary.total_signals || 1;
  const longPct = totalSig > 0 ? Math.round((summary.long_count / totalSig) * 100) : 0;

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-3">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--neon-cyan)]" />
          <h1 className="text-sm font-bold tracking-wider uppercase neon-text">Signals</h1>
          <span className="text-[10px] text-muted-foreground">Signal intelligence overview</span>
          {filterCount > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-[rgba(0,170,255,0.3)] bg-[rgba(0,170,255,0.08)] text-[#00aaff]">
              🛡 {filterCount} filter{filterCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <button onClick={fetchAll} className="text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {/* ── P&L Trade Tracker ── */}
      {perf && perf.total_closed > 0 && (
        <>
          <CollapsibleSection title="TRADE PERFORMANCE" icon={<BarChart3 className="h-3 w-3" />} summary={`${perf.total_closed} closed`} defaultOpen>
            <div className="p-3 space-y-3">
              {/* Row 1 — Performance Overview */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="text-center">
                  <div className="stat-label">Closed Trades</div>
                  <div className="text-lg font-bold font-mono neon-text">{perf.total_closed}</div>
                </div>
                <div className="text-center">
                  <div className="stat-label">Win Rate</div>
                  <div className={cn("text-lg font-bold font-mono", wrColor(perf.win_rate))}>{perf.win_rate}%</div>
                </div>
                <div className="text-center">
                  <div className="stat-label">Profit Factor</div>
                  <div className={cn("text-lg font-bold font-mono", perf.profit_factor != null ? pfColor(perf.profit_factor) : "text-muted-foreground")}>{perf.profit_factor ?? "—"}</div>
                </div>
                <div className="text-center">
                  <div className="stat-label">Streak</div>
                  <div className={cn("text-lg font-bold font-mono", perf.current_streak >= 0 ? "neon-green" : "neon-red")}>
                    {perf.current_streak > 0 ? `+${perf.current_streak}` : perf.current_streak}
                  </div>
                </div>
              </div>

              {/* Row 2 — P&L Details */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="text-center">
                  <div className="stat-label">Avg Winner</div>
                  <div className="text-lg font-bold font-mono neon-green">{fmtPctLocal(perf.avg_winner_pct)}</div>
                </div>
                <div className="text-center">
                  <div className="stat-label">Avg Loser</div>
                  <div className="text-lg font-bold font-mono neon-red">{fmtPctSigned(perf.avg_loser_pct)}%</div>
                </div>
                <div className="text-center">
                  <div className="stat-label">Best Trade</div>
                  <div className="text-lg font-bold font-mono neon-green">{fmtPctLocal(perf.best_trade_pct)}</div>
                </div>
                <div className="text-center">
                  <div className="stat-label">Worst Trade</div>
                  <div className="text-lg font-bold font-mono neon-red">{fmtPctSigned(perf.worst_trade_pct)}%</div>
                </div>
              </div>

              {/* Row 3 — Capital & Exposure (only if capital exists) */}
              {perf.capital != null && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="text-center">
                    <div className="stat-label">Capital</div>
                    <div className="text-lg font-bold font-mono neon-text">{fmtDollar(perf.capital)}</div>
                  </div>
                  <div className="text-center">
                    <div className="stat-label">Long Exposure</div>
                    <div className="text-sm font-bold font-mono neon-green">{perf.long_exposure_pct != null ? `${perf.long_exposure_pct}%` : "—"}</div>
                    {perf.long_exposure_pct != null && (
                      <div className="mt-1 h-1.5 rounded-full bg-[var(--muted)] overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(perf.long_exposure_pct, 100)}%`, backgroundColor: "#00ff88" }} />
                      </div>
                    )}
                  </div>
                  <div className="text-center">
                    <div className="stat-label">Short Exposure</div>
                    <div className="text-sm font-bold font-mono" style={{ color: "#ff4488" }}>{perf.short_exposure_pct != null ? `${perf.short_exposure_pct}%` : "—"}</div>
                    {perf.short_exposure_pct != null && (
                      <div className="mt-1 h-1.5 rounded-full bg-[var(--muted)] overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(perf.short_exposure_pct, 100)}%`, backgroundColor: "#ff4488" }} />
                      </div>
                    )}
                  </div>
                  <div className="text-center">
                    <div className="stat-label">Open Trades</div>
                    <div className="text-lg font-bold font-mono neon-text">{perf.total_open}</div>
                  </div>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* Divider */}
          <div className="border-t border-[#1a3a2a]" />
        </>
      )}

      {/* ── Summary Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { label: "TOTAL SIGNALS", value: String(summary.total_signals), color: "neon-text" },
          { label: "TODAY", value: String(summary.signals_today), color: "neon-green" },
          { label: "AVG CONFIDENCE", value: `${summary.avg_confidence}%`, color: "neon-amber" },
          { label: "LONG / SHORT", value: `${longPct}/${100 - longPct}`, color: "neon-text" },
        ].map((s) => (
          <div key={s.label} className="panel p-3 text-center">
            <div className="stat-label mb-1">{s.label}</div>
            <div className={cn("stat-value text-lg md:text-xl", s.color)}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── Quality Metrics ── */}
      {overall && overall.totalTrades > 0 && (
        <CollapsibleSection title="QUALITY METRICS" icon={<Target className="h-3 w-3" />} summary={`WR ${overall.winRate}%`}>
          <div className="p-3 space-y-3">
            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="text-center">
                <div className="stat-label">Win Rate</div>
                <div className={cn("text-lg font-bold font-mono", wrColor(overall.winRate))}>{overall.winRate}%</div>
              </div>
              <div className="text-center">
                <div className="stat-label">Profit Factor</div>
                <div className="text-lg font-bold font-mono neon-text">{overall.profitFactor ?? "—"}</div>
              </div>
              <div className="text-center">
                <div className="stat-label">Avg Winner</div>
                <div className="text-lg font-bold font-mono neon-green">+{overall.avgWin}%</div>
              </div>
              <div className="text-center">
                <div className="stat-label">Avg Loser</div>
                <div className="text-lg font-bold font-mono neon-red">{overall.avgLoss}%</div>
              </div>
            </div>

            {/* Confidence Calibration */}
            {Object.keys(calibration).length > 0 && (
              <div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Confidence Calibration</div>
                <div className="space-y-1.5">
                  {Object.entries(calibration).map(([bucket, b]) => {
                    if (!b) return null;
                    const maxT = Math.max(1, ...Object.values(calibration).map(v => v?.trades || 0));
                    const barW = b.trades > 0 ? (b.trades / maxT) * 100 : 0;
                    const goodWR = b.winRate != null && b.winRate >= 55;
                    return (
                      <div key={bucket} className="flex items-center gap-3">
                        <span className="text-[10px] font-bold text-muted-foreground w-12 shrink-0">{bucket}</span>
                        <div className="flex-1 h-3.5 rounded-sm bg-[var(--muted)] relative overflow-hidden">
                          <div className="h-full rounded-sm transition-all" style={{ width: `${barW}%`, backgroundColor: b.trades === 0 ? "var(--muted-foreground)" : (CAL_BUCKET_COLORS[bucket] || "var(--neon-amber)"), opacity: b.trades === 0 ? 0.2 : 0.7 }} />
                        </div>
                        <div className="text-right w-28 shrink-0">
                          {b.trades > 0 ? (
                            <span className={cn("text-[10px] font-bold", goodWR ? "neon-green" : "neon-red")}>
                              {b.winRate}% <span className="text-muted-foreground font-normal">({b.wins}W/{b.trades})</span>
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">No data</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* ── Expectancy Card ── */}
      {expectancy && overall && overall.totalTrades > 0 && (
        <CollapsibleSection title="EXPECTANCY" summary={`${expectancy.per_trade_pct > 0 ? "+" : ""}${expectancy.per_trade_pct}% per trade`}>
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-3">
              <span className={cn("text-2xl font-bold font-mono", expectancy.per_trade_pct > 0.5 ? "neon-green" : expectancy.per_trade_pct < -0.5 ? "neon-red" : "neon-amber")}>
                {expectancy.per_trade_pct > 0 ? "+" : ""}{expectancy.per_trade_pct}%
              </span>
              <span className="text-[10px] text-muted-foreground">per trade</span>
              <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", expectancy.per_trade_pct > 0.5 ? "bg-green-500/20 text-green-400" : expectancy.per_trade_pct < -0.5 ? "bg-red-500/20 text-red-400" : "bg-yellow-500/20 text-yellow-400")}>
                {expectancy.interpretation.toUpperCase()}
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground font-mono leading-relaxed">
              ({expectancy.win_rate}% x {expectancy.avg_win > 0 ? "+" : ""}{expectancy.avg_win}%) + ({(100 - expectancy.win_rate).toFixed(1)}% x {expectancy.avg_loss}%) = {expectancy.per_trade_pct > 0 ? "+" : ""}{expectancy.per_trade_pct}%
            </div>
            <div className="text-[10px] text-muted-foreground">
              Breakeven win rate: <span className="font-bold text-foreground">{expectancy.breakeven_wr}%</span>
              {expectancy.win_rate < expectancy.breakeven_wr && (
                <span className="neon-red ml-1">(currently {(expectancy.breakeven_wr - expectancy.win_rate).toFixed(1)}% below)</span>
              )}
              {expectancy.win_rate >= expectancy.breakeven_wr && (
                <span className="neon-green ml-1">(currently {(expectancy.win_rate - expectancy.breakeven_wr).toFixed(1)}% above)</span>
              )}
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* ── Circuit Breakers ── */}
      {circuitBreakers.length > 0 && (
        <CollapsibleSection title="CIRCUIT BREAKERS" summary={`${circuitBreakers.length} tickers`}>
          <div className="p-2">
            <div className="flex items-center gap-2 px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-muted-foreground border-b border-[var(--border)]">
              <span className="w-16">Ticker</span>
              <span className="w-8 text-center">St</span>
              <span className="w-14 text-right">Win Rate</span>
              <span className="flex-1 text-right">Trades</span>
            </div>
            {circuitBreakers.map((cb) => (
              <div key={cb.ticker} className="flex items-center gap-2 px-2 py-1.5 text-[10px] border-b border-[rgba(0,240,255,0.04)]">
                <span className="w-16 font-bold text-foreground">{cb.ticker}</span>
                <span className="w-8 text-center">
                  {cb.status === 'OK' && '🟢'}
                  {cb.status === 'WARNING' && '🟡'}
                  {cb.status === 'TRIPPED' && '🔴'}
                  {cb.status === 'INSUFFICIENT_DATA' && '⚪'}
                </span>
                <span className={cn("w-14 text-right font-mono font-bold", cb.win_rate >= 50 ? "neon-green" : cb.win_rate >= 30 ? "neon-amber" : "neon-red")}>
                  {cb.trades > 0 ? `${cb.win_rate}%` : "—"}
                </span>
                <span className="flex-1 text-right text-muted-foreground font-mono">
                  {cb.trades}/{cb.threshold >= 0 ? 10 : "?"}
                  {cb.cooldown_remaining_hours != null && (
                    <span className="neon-red ml-1">({cb.cooldown_remaining_hours}h left)</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* ── Ticker Breakdown ── */}
      {byTicker.length > 0 && (
        <CollapsibleSection title="TICKER BREAKDOWN" icon={<TrendingUp className="h-3 w-3" />} summary={`${byTicker.length} tickers`}>
          <div className="p-2">
            {/* Header */}
            <div className="flex items-center gap-2 px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-muted-foreground border-b border-[var(--border)]">
              <span className="w-16">Ticker</span>
              <span className="w-12 text-right">Signals</span>
              <span className="w-16 text-right">L / S</span>
              <span className="flex-1 text-right">Avg Conf</span>
              {tickerPerf.length > 0 && <span className="w-20 text-right">Win Rate</span>}
            </div>
            {/* Rows */}
            {byTicker.slice(0, 12).map((t) => {
              const tp = tickerPerf.find(p => p.symbol === t.ticker);
              return (
                <div key={t.ticker} className="flex items-center gap-2 px-2 py-1.5 text-[10px] border-b border-[rgba(0,240,255,0.04)] hover:bg-[rgba(0,240,255,0.03)]">
                  <span className="w-16 font-bold text-foreground">{t.ticker}</span>
                  <span className="w-12 text-right text-muted-foreground font-mono">{t.total}</span>
                  <span className="w-16 text-right">
                    <span className="neon-green">{t.long}</span>
                    <span className="text-muted-foreground"> / </span>
                    <span className="neon-red">{t.short}</span>
                  </span>
                  <span className="flex-1 text-right font-mono text-muted-foreground">{t.avg_confidence}%</span>
                  {tickerPerf.length > 0 && (
                    <span className={cn("w-20 text-right font-bold font-mono", tp ? wrColor(tp.winRate) : "text-muted-foreground")}>
                      {tp ? `${tp.winRate}%` : "—"}
                      {tp && <span className="text-muted-foreground font-normal text-[8px] ml-0.5">({tp.trades})</span>}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {/* ── Ticker Performance (P&L chart) ── */}
      {tickerPerf.length > 0 && (
        <CollapsibleSection title="P&L BY TICKER">
          <div className="p-3">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={tickerPerf.map(t => ({ name: t.symbol, pnl: t.totalPnl, trades: t.trades, winRate: t.winRate, wins: t.wins }))} margin={{ left: 0, right: 0, top: 5, bottom: 5 }}>
              <XAxis dataKey="name" tick={{ fill: CHART_COLORS.textMuted, fontSize: 10 }} />
              <YAxis tick={{ fill: CHART_COLORS.textMuted, fontSize: 10 }} width={40} />
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div style={{ background: "#161b22", border: "1px solid #30363d", padding: "8px 12px", borderRadius: 4, fontSize: 11, fontFamily: "monospace" }}>
                    <div style={{ color: "#58a6ff", fontWeight: 700, marginBottom: 4 }}>{d.name}</div>
                    <div style={{ color: d.pnl >= 0 ? "#00ff88" : "#ff4444" }}>P&L: {d.pnl >= 0 ? "+" : ""}{d.pnl.toFixed(2)}%</div>
                    <div style={{ color: "#e0e0e8" }}>Trades: {d.trades} ({d.wins}W)</div>
                    <div style={{ color: d.winRate >= 50 ? "#00ff88" : "#ff4444" }}>Win Rate: {d.winRate}%</div>
                  </div>
                );
              }} />
              <Bar dataKey="pnl" fillOpacity={0.7} radius={[3, 3, 0, 0]}>
                {tickerPerf.map((t, i) => (
                  <Cell key={i} fill={t.totalPnl >= 0 ? CHART_COLORS.green : CHART_COLORS.red} fillOpacity={0.7} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        </CollapsibleSection>
      )}

      {/* ── Direction Trend (last 14 days) ── */}
      {dirTrend.length > 1 && (
        <CollapsibleSection title="DIRECTION TREND" icon={<TrendingDown className="h-3 w-3" />} summary="Last 14 days">
          <div className="p-3">
          <StyledBarChart
            data={dirTrend.map(d => ({ date: d.date?.slice(5) || "", long: d.long, short: -d.short }))}
            dataKey="long"
            nameKey="date"
            height={140}
            colorByValue
            positiveColor="#00ff88"
            negativeColor="#ff4488"
          />
          </div>
        </CollapsibleSection>
      )}

      {/* ── Confidence Distribution ── */}
      {Object.keys(confDist).length > 0 && (
        <CollapsibleSection title="CONFIDENCE DISTRIBUTION">
          <div className="p-3">
          <StyledBarChart
            data={Object.entries(confDist)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([bucket, count]) => ({ name: BUCKET_LABELS[bucket] || bucket, count }))}
            dataKey="count"
            nameKey="name"
            height={140}
            horizontal
            colors={CONF_DIST_COLORS}
          />
          </div>
        </CollapsibleSection>
      )}

      {/* ── Cumulative P&L ── */}
      {dailyPnl.length > 1 && (
        <CollapsibleSection title="CUMULATIVE P&L">
          <div className="p-3">
          <StyledLineChart
            data={dailyPnl.map(d => ({ date: d.date?.slice(5) || "", cumulative: d.cumulative }))}
            lines={[{ dataKey: "cumulative", color: "#00ff88", name: "Cum P&L %" }]}
            xKey="date"
            height={160}
            showArea
            referenceLine={0}
            splitColorAtZero
          />
          </div>
        </CollapsibleSection>
      )}

      {/* ── Empty state ── */}
      {!data && !loading && (
        <EmptyState icon={Activity} message="No signal data available" />
      )}

      {/* ── Confidence Tier Analysis ── */}
      <ConfidenceTierSection />
    </div>
  );
}

/* ── Confidence Tier Analytics ── */
function ConfidenceTierSection() {
  const [tiers, setTiers] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    safeFetch<Record<string, unknown>>("/api/analytics/confidence-tiers", {}).then(d => {
      if (d && Object.keys(d).length > 0) setTiers(d);
    });
  }, []);

  if (!tiers?.available) {
    if (tiers && !tiers.available) {
      return (
        <CollapsibleSection title="SIGNAL QUALITY BY CONFIDENCE" icon={<Target className="h-3 w-3" />} defaultOpen>
          <div className="p-3 text-[11px] text-muted-foreground text-center py-4">
            {String(tiers.reason ?? "Confidence tier data not available.")}
          </div>
        </CollapsibleSection>
      );
    }
    return null;
  }

  type Tier = { confidence_range: string; label: string; trade_count: number; wins: number; losses: number; win_rate: number; avg_pnl_pct: number; total_pnl_pct: number; profit_factor: number | null; recommendation: string };
  const tierList = (tiers.tiers as Tier[]) ?? [];
  const rec = tiers.overall_recommendation as Record<string, unknown> | null;
  const takeRate = Number(tiers.take_rate ?? 0);
  const totalSignals = Number(tiers.total_signals ?? 0);
  const taken = Number(tiers.signals_taken ?? 0);

  return (
    <CollapsibleSection title="SIGNAL QUALITY BY CONFIDENCE" icon={<Target className="h-3 w-3" />} summary={`${takeRate}% take rate`} defaultOpen>
      <div className="p-3 space-y-3">
      {/* Take rate */}
      <div className="text-[10px] text-muted-foreground">
        You take <span className="text-foreground font-bold">{takeRate}%</span> of generated signals ({taken} of {totalSignals}).
      </div>

      {/* Tier cards */}
      <div className="space-y-1.5">
        {tierList.map(t => {
          const borderColor = t.trade_count < 3 ? "border-l-amber-500/50" : (t.profit_factor ?? 0) >= 1 ? "border-l-green-500/50" : "border-l-red-500/50";
          return (
            <div key={t.confidence_range} className={cn("border-l-2 px-2.5 py-2 rounded-r bg-[rgba(255,255,255,0.02)]", borderColor)}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[11px] font-bold">{t.label}</span>
                <span className="text-[9px] text-muted-foreground">{t.trade_count} taken</span>
              </div>
              {t.trade_count > 0 ? (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                  <span>WR: <span className={cn("font-mono", t.win_rate >= 50 ? "neon-green" : "neon-red")}>{t.win_rate}%</span></span>
                  <span>Avg: <span className={cn("font-mono", t.avg_pnl_pct >= 0 ? "neon-green" : "neon-red")}>{fmtPctSigned(t.avg_pnl_pct)}%</span></span>
                  <span>PF: <span className="font-mono">{t.profit_factor ?? "—"}</span></span>
                  <span>P&L: <span className={cn("font-mono", t.total_pnl_pct >= 0 ? "neon-green" : "neon-red")}>{fmtPctSigned(t.total_pnl_pct)}%</span></span>
                </div>
              ) : (
                <div className="text-[10px] text-muted-foreground/50">No trades taken at this level</div>
              )}
              <div className="text-[9px] text-muted-foreground/70 mt-0.5">{t.recommendation}</div>
            </div>
          );
        })}
      </div>

      {/* Recommendation */}
      {rec && (
        <div className="border-l-2 border-amber-500/50 bg-amber-500/5 px-2.5 py-1.5 text-[10px] text-muted-foreground">
          <span className="font-bold text-amber-400">RECOMMENDATION:</span> {String(rec.impact ?? "")}
        </div>
      )}
      </div>
    </CollapsibleSection>
  );
}

/* ── Collapsible Section ── */
function CollapsibleSection({ title, icon, summary, defaultOpen = false, children }: {
  title: string;
  icon?: React.ReactNode;
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="panel overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full panel-header flex items-center gap-1.5 cursor-pointer hover:bg-[rgba(0,240,255,0.03)] transition-colors"
      >
        {icon}
        <span className="text-left">{title}</span>
        {summary && <span className="ml-auto text-muted-foreground font-normal text-[9px] mr-2">{summary}</span>}
        <span className={cn("text-muted-foreground transition-transform duration-200 text-[10px]", !summary && "ml-auto", open && "rotate-90")}>▸</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}
