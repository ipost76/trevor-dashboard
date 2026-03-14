"use client";
import { useEffect, useState, useCallback } from "react";
import { Activity, CheckCircle, XCircle, Clock, RefreshCw, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { TabBar, type TabDef } from "@/components/ui/tab-bar";
import { EmptyState } from "@/components/ui/empty-state";

type Signal = {
  id: number; ticker: string; signal_type: string; confidence: number;
  outcome: string; created_at: string; direction?: string;
  timeframe?: string; entry_price?: number; target_price?: number; stop_price?: number;
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

export default function SignalsPage() {
  const [tab, setTab] = useState<Tab>("feed");
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  // Quality data
  const [overall, setOverall] = useState<Overall | null>(null);
  const [calibration, setCalibration] = useState<Record<string, CalBucket>>({});
  const [tickers, setTickers] = useState<TickerPerf[]>([]);
  const [sortKey, setSortKey] = useState<"trades" | "winRate" | "totalPnl">("trades");
  const [sortAsc, setSortAsc] = useState(false);

  const fetchSignals = useCallback(async () => {
    const d = await safeFetch<{ recentSignals?: Signal[] }>("/api/live", {});
    setSignals(d.recentSignals || []);
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
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (tab === "feed") {
      fetchSignals();
      const i = setInterval(fetchSignals, 15000);
      return () => clearInterval(i);
    } else {
      fetchQuality();
    }
  }, [tab, fetchSignals, fetchQuality]);

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
          /* ── Signal Feed ── */
          <>
            <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--border)] text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground bg-[var(--panel-header)]">
              <span className="w-16">Ticker</span>
              <span className="w-12">Dir</span>
              <span className="flex-1">Signal</span>
              <span className="w-14 text-right">Conf</span>
              <span className="w-16 text-right">Entry</span>
              <span className="w-16 text-right">Target</span>
              <span className="w-16 text-right">Stop</span>
              <span className="w-10 text-center">Result</span>
              <span className="w-20 text-right">Time</span>
            </div>
            <div className="flex-1 overflow-auto">
              {signals.map((s, i) => {
                const isLong = s.direction?.toLowerCase() === "long" || s.direction?.toLowerCase() === "buy";
                const time = s.created_at ? new Date(s.created_at).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" }) : "";
                return (
                  <div key={s.id || i} className="flex items-center gap-2 data-cell hover:bg-[rgba(0,240,255,0.03)] transition-colors">
                    <span className="w-16 font-bold text-foreground truncate">{s.ticker}</span>
                    <span className="w-12"><span className={isLong ? "badge-long" : "badge-short"}>{isLong ? "LONG" : "SHORT"}</span></span>
                    <span className="flex-1 text-muted-foreground truncate">{s.signal_type}</span>
                    <span className="w-14 text-right"><span className={cn("font-bold", s.confidence >= 70 ? "neon-green" : s.confidence >= 50 ? "neon-amber" : "neon-red")}>{s.confidence}%</span></span>
                    <span className="w-16 text-right text-muted-foreground">{s.entry_price ? `$${s.entry_price.toFixed(2)}` : "-"}</span>
                    <span className="w-16 text-right text-[var(--neon-green)] opacity-70">{s.target_price ? `$${s.target_price.toFixed(2)}` : "-"}</span>
                    <span className="w-16 text-right text-[var(--neon-red)] opacity-70">{s.stop_price ? `$${s.stop_price.toFixed(2)}` : "-"}</span>
                    <span className="w-10 flex justify-center">
                      {s.outcome === "win" && <CheckCircle className="h-3.5 w-3.5 text-[var(--neon-green)]" />}
                      {s.outcome === "loss" && <XCircle className="h-3.5 w-3.5 text-[var(--neon-red)]" />}
                      {!s.outcome && <Clock className="h-3.5 w-3.5 text-muted-foreground" />}
                    </span>
                    <span className="w-20 text-right text-[10px] text-muted-foreground">{time}</span>
                  </div>
                );
              })}
              {signals.length === 0 && (
                <EmptyState icon={Activity} message="No signals generated yet" className="py-12" />
              )}
            </div>
          </>
        ) : (
          /* ── Quality Tab ── */
          <div className="flex-1 overflow-auto p-3">
            {!overall || overall.totalTrades === 0 ? (
              <EmptyState icon={Target} message="No trade data yet" sub="Take some trades and check back!" className="py-12" />
            ) : (
              <>
                {/* Overall Stats */}
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
                  {/* Calibration */}
                  <div className="panel">
                    <div className="panel-header">CONFIDENCE CALIBRATION</div>
                    <div className="p-3 space-y-2">
                      {["50-60", "60-70", "70-80", "80-90", "90+"].map(bucket => {
                        const b = calibration[bucket];
                        if (!b) return null;
                        const maxT = Math.max(1, ...Object.values(calibration).map(v => v?.trades || 0));
                        const barW = b.trades > 0 ? (b.trades / maxT) * 100 : 0;
                        const midpoint = bucket === "90+" ? 92.5 : (parseInt(bucket) + parseInt(bucket.split("-")[1] || "100")) / 2;
                        const calibrated = b.winRate != null && b.winRate >= midpoint;
                        return (
                          <div key={bucket} className="flex items-center gap-3">
                            <span className="text-[10px] font-bold text-muted-foreground w-10 shrink-0">{bucket}%</span>
                            <div className="flex-1 h-4 rounded-sm bg-[var(--muted)] relative overflow-hidden">
                              <div className="h-full rounded-sm transition-all" style={{ width: `${barW}%`, backgroundColor: b.trades === 0 ? "var(--muted-foreground)" : calibrated ? "var(--neon-green)" : "var(--neon-red)", opacity: b.trades === 0 ? 0.2 : 0.7 }} />
                            </div>
                            <div className="text-right w-20 shrink-0">
                              {b.trades > 0 ? (
                                <span className={cn("text-[10px] font-bold", calibrated ? "neon-green" : "neon-red")}>
                                  {b.winRate}% <span className="text-muted-foreground font-normal">({b.trades})</span>
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

                  {/* Ticker Performance */}
                  <div className="panel">
                    <div className="panel-header">TICKER PERFORMANCE</div>
                    <div className="overflow-auto max-h-[400px]">
                      <table className="w-full text-[11px] font-mono">
                        <thead>
                          <tr className="text-muted-foreground text-[9px] uppercase tracking-wider">
                            <th className="text-left p-2">Ticker</th>
                            <th className="text-right p-2 cursor-pointer hover:text-foreground" onClick={() => handleSort("trades")}>Trades {sortKey === "trades" && (sortAsc ? "▲" : "▼")}</th>
                            <th className="text-right p-2 cursor-pointer hover:text-foreground" onClick={() => handleSort("winRate")}>Win Rate {sortKey === "winRate" && (sortAsc ? "▲" : "▼")}</th>
                            <th className="text-right p-2 cursor-pointer hover:text-foreground" onClick={() => handleSort("totalPnl")}>P&L {sortKey === "totalPnl" && (sortAsc ? "▲" : "▼")}</th>
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
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
