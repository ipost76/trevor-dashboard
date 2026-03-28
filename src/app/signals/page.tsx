"use client";
import { useEffect, useState, useCallback } from "react";
import { Activity, RefreshCw, TrendingUp, TrendingDown, Target, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StyledBarChart } from "@/components/charts/StyledBarChart";
import { StyledLineChart } from "@/components/charts/StyledLineChart";
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
const fmtPct = (v: number) => v >= 0 ? `+${v.toFixed(2)}%` : `${v.toFixed(2)}%`;

const BUCKET_LABELS: Record<string, string> = {
  "35_44": "35-44%", "45_54": "45-54%", "55_64": "55-64%", "65_plus": "65%+",
};

/* ── Page ── */
export default function SignalsPage() {
  const [data, setData] = useState<SignalData | null>(null);
  const [dailyPnl, setDailyPnl] = useState<DailyPnl[]>([]);
  const [loading, setLoading] = useState(true);

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

  const summary = data?.summary ?? EMPTY_SUMMARY;
  const overall = data?.quality?.overall;
  const calibration = data?.quality?.calibration ?? {};
  const tickerPerf = data?.quality?.ticker_performance ?? [];
  const byTicker = data?.by_ticker ?? [];
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
        </div>
        <button onClick={fetchAll} className="text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {/* ── P&L Trade Tracker ── */}
      {perf && perf.total_closed > 0 && (
        <>
          <div className="panel">
            <div className="panel-header flex items-center gap-1.5">
              <BarChart3 className="h-3 w-3" />
              <span>TRADE PERFORMANCE</span>
              <span className="ml-auto text-muted-foreground font-normal text-[9px]">{perf.total_closed} closed</span>
            </div>
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
                  <div className="text-lg font-bold font-mono neon-green">{fmtPct(perf.avg_winner_pct)}</div>
                </div>
                <div className="text-center">
                  <div className="stat-label">Avg Loser</div>
                  <div className="text-lg font-bold font-mono neon-red">{perf.avg_loser_pct.toFixed(2)}%</div>
                </div>
                <div className="text-center">
                  <div className="stat-label">Best Trade</div>
                  <div className="text-lg font-bold font-mono neon-green">{fmtPct(perf.best_trade_pct)}</div>
                </div>
                <div className="text-center">
                  <div className="stat-label">Worst Trade</div>
                  <div className="text-lg font-bold font-mono neon-red">{perf.worst_trade_pct.toFixed(2)}%</div>
                </div>
              </div>

              {/* Row 3 — Capital & Exposure (only if capital exists) */}
              {perf.capital != null && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="text-center">
                    <div className="stat-label">Capital</div>
                    <div className="text-lg font-bold font-mono neon-text">${perf.capital.toFixed(2)}</div>
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
          </div>

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
        <div className="panel">
          <div className="panel-header flex items-center gap-1.5">
            <Target className="h-3 w-3" />
            <span>QUALITY METRICS</span>
            <span className="ml-auto text-muted-foreground font-normal text-[9px]">{overall.totalTrades} closed trades</span>
          </div>
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
        </div>
      )}

      {/* ── Ticker Breakdown ── */}
      {byTicker.length > 0 && (
        <div className="panel">
          <div className="panel-header flex items-center gap-1.5">
            <TrendingUp className="h-3 w-3" />
            <span>TICKER BREAKDOWN</span>
          </div>
          <div className="p-2">
            {/* Header */}
            <div className="flex items-center gap-2 px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-muted-foreground border-b border-[var(--border)]">
              <span className="w-16">Ticker</span>
              <span className="w-12 text-right">Signals</span>
              <span className="w-16 text-right">L / S</span>
              <span className="flex-1 text-right">Avg Conf</span>
              {tickerPerf.length > 0 && <span className="w-14 text-right">Win Rate</span>}
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
                    <span className={cn("w-14 text-right font-bold font-mono", tp ? wrColor(tp.winRate) : "text-muted-foreground")}>
                      {tp ? `${tp.winRate}%` : "—"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Ticker Performance (P&L chart) ── */}
      {tickerPerf.length > 0 && (
        <div className="panel p-3">
          <div className="panel-header mb-2">P&L BY TICKER</div>
          <StyledBarChart
            data={tickerPerf.map(t => ({ name: t.symbol, pnl: t.totalPnl }))}
            dataKey="pnl"
            nameKey="name"
            height={160}
            colorByValue
          />
        </div>
      )}

      {/* ── Direction Trend (last 14 days) ── */}
      {dirTrend.length > 1 && (
        <div className="panel p-3">
          <div className="panel-header mb-2 flex items-center gap-1.5">
            <TrendingDown className="h-3 w-3" />
            <span>DIRECTION TREND</span>
            <span className="ml-auto text-muted-foreground font-normal text-[9px]">Last 14 days</span>
          </div>
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
      )}

      {/* ── Confidence Distribution ── */}
      {Object.keys(confDist).length > 0 && (
        <div className="panel p-3">
          <div className="panel-header mb-2">CONFIDENCE DISTRIBUTION</div>
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
      )}

      {/* ── Cumulative P&L ── */}
      {dailyPnl.length > 1 && (
        <div className="panel p-3">
          <div className="panel-header mb-2">CUMULATIVE P&L</div>
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
      )}

      {/* ── Empty state ── */}
      {!data && !loading && (
        <EmptyState icon={Activity} message="No signal data available" />
      )}
    </div>
  );
}
