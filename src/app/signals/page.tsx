"use client";
import { useEffect, useState, useCallback } from "react";
import { Activity, CheckCircle, XCircle, Clock, RefreshCw, Target, ChevronDown, ChevronUp, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { TabBar, type TabDef } from "@/components/ui/tab-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { StyledBarChart } from "@/components/charts/StyledBarChart";
import { StyledLineChart } from "@/components/charts/StyledLineChart";

type Breakdown = { momentum: number; trend: number; volume: number; volatility: number; microstructure: number };
type Signal = {
  id: number; ticker: string; direction: string; confidence: number;
  outcome: string | null; created_at: string;
  timeframe?: string; entry_price?: number; target_price?: number; stop_price?: number;
  reasoning?: string; strategy?: string; multi_tf?: boolean;
  result_pct?: number; exit_reason?: string;
  breakdown?: Breakdown; regime?: string; quality_tier?: string;
  rr_ratio?: number; groups_confirmed?: number;
};

type CalBucket = { trades: number; wins: number; winRate: number | null };
type TickerPerf = { symbol: string; trades: number; wins: number; winRate: number; totalPnl: number };
type Overall = {
  totalTrades: number; wins: number; losses: number; winRate: number;
  totalPnl: number; avgPnl: number; avgWin: number; avgLoss: number; profitFactor: number | null;
};

type Tab = "feed" | "quality";
const tabs: TabDef<Tab>[] = [
  { key: "feed", label: "Signal Feed", icon: Activity },
  { key: "quality", label: "Quality", icon: Target },
];

function relativeTime(iso: string): string {
  const d = new Date(iso + (iso.includes("Z") ? "" : "Z"));
  const now = Date.now();
  const diff = Math.max(0, now - d.getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

function ConfBar({ score, max = 20, fired }: { score: number; max?: number; fired?: boolean }) {
  const pct = Math.min(100, (score / max) * 100);
  return (
    <div className="h-2 w-full rounded-sm bg-[var(--muted)] overflow-hidden">
      <div
        className={cn("h-full rounded-sm transition-all", fired !== false ? "bg-[var(--neon-cyan)]" : "bg-[var(--muted-foreground)] opacity-30")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function BreakdownPanel({ b }: { b: Breakdown }) {
  const groups = [
    { key: "momentum", label: "M", full: "Momentum" },
    { key: "trend", label: "T", full: "Trend" },
    { key: "volume", label: "V", full: "Volume" },
    { key: "volatility", label: "X", full: "Volatility" },
    { key: "microstructure", label: "u", full: "Micro" },
  ] as const;
  return (
    <div className="grid grid-cols-5 gap-2 mt-2 px-1">
      {groups.map(g => {
        const val = b[g.key] || 0;
        return (
          <div key={g.key} className="text-center">
            <div className="text-[8px] uppercase text-muted-foreground mb-0.5" title={g.full}>{g.label}</div>
            <ConfBar score={val} fired={val > 0} />
            <div className="text-[9px] font-bold mt-0.5">{val}</div>
          </div>
        );
      })}
    </div>
  );
}

function SignalCard({ s, expanded, onToggle }: { s: Signal; expanded: boolean; onToggle: () => void }) {
  const isLong = s.direction?.toUpperCase() === "LONG";
  const time = relativeTime(s.created_at || "");
  const absTime = s.created_at ? new Date(s.created_at + (s.created_at.includes("Z") ? "" : "Z")).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "";
  const tierColor = s.quality_tier === "A" ? "neon-green" : s.quality_tier === "B" ? "neon-amber" : "text-muted-foreground";
  const rr = s.rr_ratio ? s.rr_ratio.toFixed(1) : "?";

  return (
    <div className="border-b border-[var(--border)] hover:bg-[rgba(0,240,255,0.03)] transition-colors">
      <div className="flex items-center gap-1.5 md:gap-2 data-cell cursor-pointer min-w-0" onClick={onToggle}>
        <span className="w-16 md:w-20 font-bold text-foreground truncate shrink-0">{s.ticker}</span>
        <span className="shrink-0"><span className={isLong ? "badge-long" : "badge-short"}>{isLong ? "L" : "S"}</span></span>
        <span className="hidden md:inline shrink-0">{s.quality_tier && <span className={cn("text-[9px] font-bold px-1 rounded", tierColor)}>{s.quality_tier}</span>}</span>
        <span className="hidden md:inline shrink-0">{s.regime && <span className="text-[8px] px-1 rounded bg-[var(--muted)] text-muted-foreground">{s.regime}</span>}</span>
        <span className="flex-1 min-w-0" />
        <span className={cn("shrink-0 font-bold", s.confidence >= 70 ? "neon-green" : s.confidence >= 50 ? "neon-amber" : "neon-red")}>{s.confidence}</span>
        <span className="hidden md:inline w-12 text-right text-[10px] text-muted-foreground shrink-0">{rr}:1</span>
        <span className="w-6 md:w-10 flex justify-center shrink-0">
          {s.outcome === "win" && <CheckCircle className="h-3.5 w-3.5 text-[var(--neon-green)]" />}
          {s.outcome === "loss" && <XCircle className="h-3.5 w-3.5 text-[var(--neon-red)]" />}
          {!s.outcome && <Clock className="h-3.5 w-3.5 text-muted-foreground" />}
        </span>
        <span className="w-10 md:w-16 text-right text-[10px] text-muted-foreground shrink-0" title={absTime}>{time}</span>
        {expanded ? <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />}
      </div>
      {expanded && (
        <div className="px-4 pb-3 pt-1 space-y-2">
          <div className="flex gap-4 text-[10px]">
            <span>Entry: <b className="text-foreground">${s.entry_price?.toFixed(2) || "?"}</b></span>
            <span>Stop: <b className="neon-red">${s.stop_price?.toFixed(2) || "?"}</b></span>
            <span>Target: <b className="neon-green">${s.target_price?.toFixed(2) || "?"}</b></span>
            <span>R:R: <b>{rr}:1</b></span>
            {s.groups_confirmed != null && <span>Groups: <b>{s.groups_confirmed}/5</b></span>}
          </div>
          {s.breakdown && <BreakdownPanel b={s.breakdown} />}
          {s.reasoning && (
            <div className="text-[10px] text-muted-foreground mt-1 leading-relaxed">{s.reasoning}</div>
          )}
          {s.result_pct != null && (
            <div className={cn("text-[10px] font-bold", s.result_pct >= 0 ? "neon-green" : "neon-red")}>
              Result: {s.result_pct >= 0 ? "+" : ""}{s.result_pct.toFixed(1)}%
              {s.exit_reason && <span className="text-muted-foreground font-normal ml-2">({s.exit_reason})</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SignalsPage() {
  const [tab, setTab] = useState<Tab>("feed");
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // Filters
  const [dirFilter, setDirFilter] = useState<string>("all");
  const [regimeFilter, setRegimeFilter] = useState<string>("all");
  const [minConf, setMinConf] = useState(0);
  const [sortBy, setSortBy] = useState<"time" | "confidence" | "rr">("time");
  const [showFilters, setShowFilters] = useState(false);
  // Quality
  const [overall, setOverall] = useState<Overall | null>(null);
  const [calibration, setCalibration] = useState<Record<string, CalBucket>>({});
  const [tickers, setTickers] = useState<TickerPerf[]>([]);
  const [dailyPnl, setDailyPnl] = useState<Array<{ date: string; pnl: number; cumulative: number; trades: number }>>([]);
  const [sortKey, setSortKey] = useState<"trades" | "winRate" | "totalPnl">("trades");
  const [sortAsc, setSortAsc] = useState(false);

  const fetchSignals = useCallback(async () => {
    const d = await safeFetch<{ ok: boolean; signals: Signal[] }>("/api/signals?limit=100", { ok: false, signals: [] });
    setSignals(d.signals || []);
    setLoading(false);
  }, []);

  const fetchQuality = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await safeFetch<any>("/api/signal-quality", null);
    if (raw) {
      setOverall(raw.overall || null);
      setCalibration(raw.calibration || {});
      setTickers(raw.tickerPerformance || []);
      const pnlData = await safeFetch<Array<{ date: string; pnl: number; cumulative: number; trades: number }>>("/api/stats/daily-pnl", []);
      setDailyPnl(pnlData);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (tab === "feed") {
      fetchSignals();
      const i = setInterval(fetchSignals, 30000);
      return () => clearInterval(i);
    } else {
      fetchQuality();
    }
  }, [tab, fetchSignals, fetchQuality]);

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Apply filters + sort
  const filtered = signals
    .filter(s => dirFilter === "all" || s.direction?.toUpperCase() === dirFilter)
    .filter(s => regimeFilter === "all" || (s.regime || "").toUpperCase().includes(regimeFilter))
    .filter(s => s.confidence >= minConf)
    .sort((a, b) => {
      if (sortBy === "confidence") return (b.confidence || 0) - (a.confidence || 0);
      if (sortBy === "rr") return (b.rr_ratio || 0) - (a.rr_ratio || 0);
      return 0; // time is default (already sorted by API)
    });

  const wrColor = (wr: number) => wr >= 55 ? "neon-green" : wr < 45 ? "neon-red" : "neon-amber";
  const sortedTickers = [...tickers].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });
  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  return (
    <div className="flex-1 overflow-auto p-2">
      <div className="panel h-full flex flex-col">
        <TabBar tabs={tabs} active={tab} onChange={setTab} />

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <RefreshCw className="h-5 w-5 animate-spin text-[var(--neon-cyan)]" />
          </div>
        ) : tab === "feed" ? (
          <>
            {/* Filter Bar */}
            <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--border)] bg-[var(--panel-header)]">
              <button onClick={() => setShowFilters(!showFilters)} className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground">
                <Filter className="h-3 w-3" /> Filters {showFilters ? "▲" : "▼"}
              </button>
              <span className="flex-1" />
              <span className="text-[9px] text-muted-foreground">{filtered.length} signals</span>
            </div>
            {showFilters && (
              <div className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-[var(--border)] bg-[rgba(0,0,0,0.3)] text-[10px]">
                <label className="flex items-center gap-1">
                  Dir:
                  <select value={dirFilter} onChange={e => setDirFilter(e.target.value)} className="input-terminal text-[10px] px-1 py-0.5 w-16">
                    <option value="all">All</option>
                    <option value="LONG">Long</option>
                    <option value="SHORT">Short</option>
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  Regime:
                  <select value={regimeFilter} onChange={e => setRegimeFilter(e.target.value)} className="input-terminal text-[10px] px-1 py-0.5 w-24">
                    <option value="all">All</option>
                    <option value="TRENDING">Trending</option>
                    <option value="VOLATILE">Volatile</option>
                    <option value="RANGING">Ranging</option>
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  Min Conf: <b>{minConf}</b>
                  <input type="range" min={0} max={100} value={minConf} onChange={e => setMinConf(Number(e.target.value))} className="w-20 h-1" />
                </label>
                <label className="flex items-center gap-1">
                  Sort:
                  <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} className="input-terminal text-[10px] px-1 py-0.5 w-20">
                    <option value="time">Time</option>
                    <option value="confidence">Conf</option>
                    <option value="rr">R:R</option>
                  </select>
                </label>
              </div>
            )}

            {/* Column Headers */}
            <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--border)] text-[8px] font-bold uppercase tracking-[0.1em] text-muted-foreground bg-[var(--panel-header)]">
              <span className="w-20">Ticker</span>
              <span className="w-14">Dir</span>
              <span className="w-8">Tier</span>
              <span className="w-16">Regime</span>
              <span className="flex-1" />
              <span className="w-10 text-right">Conf</span>
              <span className="w-12 text-right">R:R</span>
              <span className="w-10 text-center">Result</span>
              <span className="w-16 text-right">Time</span>
              <span className="w-4" />
            </div>

            {/* Signal Cards */}
            <div className="flex-1 overflow-auto">
              {filtered.map(s => (
                <SignalCard key={s.id} s={s} expanded={expanded.has(s.id)} onToggle={() => toggleExpand(s.id)} />
              ))}
              {filtered.length === 0 && (
                <EmptyState icon={Activity} message="No signals match filters" className="py-12" />
              )}
            </div>
          </>
        ) : (
          /* Quality Tab — unchanged */
          <div className="flex-1 overflow-auto p-3">
            {!overall || overall.totalTrades === 0 ? (
              <EmptyState icon={Target} message="No trade data yet" sub="Take some trades and check back!" className="py-12" />
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4 stagger-cards">
                  {[
                    { label: "TOTAL TRADES", value: String(overall.totalTrades) },
                    { label: "WIN RATE", value: `${overall.winRate}%`, color: wrColor(overall.winRate) },
                    { label: "TOTAL P&L", value: `${overall.totalPnl >= 0 ? "+" : ""}${overall.totalPnl}%`, color: overall.totalPnl >= 0 ? "neon-green" : "neon-red" },
                    { label: "PROFIT FACTOR", value: overall.profitFactor != null ? String(overall.profitFactor) : "N/A", color: "neon-text" },
                    { label: "AVG WIN", value: `+${overall.avgWin}%`, color: "neon-green" },
                    { label: "AVG LOSS", value: `${overall.avgLoss}%`, color: "neon-red" },
                  ].map(s => (
                    <div key={s.label} className="panel p-3 text-center">
                      <div className="stat-label mb-1">{s.label}</div>
                      <div className={cn("stat-value", s.color || "text-foreground")}>{s.value}</div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="panel">
                    <div className="panel-header">CONFIDENCE CALIBRATION</div>
                    <div className="p-3 space-y-2">
                      {Object.entries(calibration).map(([bucket, b]) => {
                        if (!b) return null;
                        const maxT = Math.max(1, ...Object.values(calibration).map(v => v?.trades || 0));
                        const barW = b.trades > 0 ? (b.trades / maxT) * 100 : 0;
                        const goodWR = b.winRate != null && b.winRate >= 55;
                        return (
                          <div key={bucket} className="flex items-center gap-3">
                            <span className="text-[10px] font-bold text-muted-foreground w-12 shrink-0">{bucket}%</span>
                            <div className="flex-1 h-4 rounded-sm bg-[var(--muted)] relative overflow-hidden">
                              <div className="h-full rounded-sm transition-all" style={{ width: `${barW}%`, backgroundColor: b.trades === 0 ? "var(--muted-foreground)" : goodWR ? "var(--neon-green)" : b.winRate != null && b.winRate >= 45 ? "var(--neon-amber)" : "var(--neon-red)", opacity: b.trades === 0 ? 0.2 : 0.7 }} />
                            </div>
                            <div className="text-right w-24 shrink-0">
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

                  <div className="panel">
                    <div className="panel-header">TICKER PERFORMANCE</div>
                    <div className="overflow-auto max-h-[400px]">
                      <table className="w-full text-[11px] font-mono">
                        <thead>
                          <tr className="text-muted-foreground text-[9px] uppercase tracking-wider">
                            <th className="text-left p-2">Ticker</th>
                            <th className="text-right p-2 cursor-pointer hover:text-foreground" onClick={() => handleSort("trades")}>Trades {sortKey === "trades" && (sortAsc ? "^" : "v")}</th>
                            <th className="text-right p-2 cursor-pointer hover:text-foreground" onClick={() => handleSort("winRate")}>Win Rate {sortKey === "winRate" && (sortAsc ? "^" : "v")}</th>
                            <th className="text-right p-2 cursor-pointer hover:text-foreground" onClick={() => handleSort("totalPnl")}>P&L {sortKey === "totalPnl" && (sortAsc ? "^" : "v")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedTickers.map(t => (
                            <tr key={t.symbol} className="border-b border-[rgba(0,240,255,0.06)] hover:bg-[rgba(0,240,255,0.03)]">
                              <td className="p-2 font-bold text-foreground">{t.symbol}</td>
                              <td className="p-2 text-right text-muted-foreground">{t.trades}</td>
                              <td className={cn("p-2 text-right font-bold", wrColor(t.winRate))}>{t.winRate}%</td>
                              <td className="p-2 text-right"><span className={cn("font-bold", t.totalPnl >= 0 ? "neon-green" : "neon-red")}>{t.totalPnl >= 0 ? "+" : ""}{t.totalPnl}%</span></td>
                            </tr>
                          ))}
                          {sortedTickers.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">No ticker data</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
                  {/* Ticker Performance Chart */}
                  {sortedTickers.length > 0 && (
                    <div className="panel p-3">
                      <div className="panel-header mb-2">P&L BY TICKER</div>
                      <StyledBarChart
                        data={sortedTickers.map(t => ({ name: t.symbol, pnl: t.totalPnl }))}
                        dataKey="pnl"
                        nameKey="name"
                        height={180}
                        colorByValue
                      />
                    </div>
                  )}

                  {/* Cumulative P&L Over Time */}
                  {dailyPnl.length > 0 && (
                    <div className="panel p-3">
                      <div className="panel-header mb-2">CUMULATIVE P&L</div>
                      <StyledLineChart
                        data={dailyPnl.map(d => ({ date: d.date?.slice(5) || "", cumulative: d.cumulative }))}
                        lines={[{ dataKey: "cumulative", color: "#00ff88", name: "Cum P&L %" }]}
                        xKey="date"
                        height={180}
                        showArea
                        referenceLine={0}
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
