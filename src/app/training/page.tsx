"use client";

import { useEffect, useState, useCallback } from "react";
import { Database, RefreshCw, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";

export default function TrainingPage() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    const d = await safeFetch<Record<string, unknown>>("/api/training?scope=summary", {});
    setData(Object.keys(d).length > 0 ? d : null);
    setLoading(false);
  }, []);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);

  return (
    <div className="flex-1 overflow-auto p-2">
      <div className="panel h-full flex flex-col">
        <div className="panel-header flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5" />
          <span>TRAINING DATA</span>
          <button onClick={fetchOverview} className="ml-auto p-1 text-muted-foreground hover:text-foreground">
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          </button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <RefreshCw className="h-5 w-5 animate-spin text-[var(--neon-cyan)]" />
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-3 space-y-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { label: "Total Trades", value: String((data as Record<string, unknown>)?.totalRecords ?? (data as Record<string, unknown>)?.totalTrades ?? "—").replace(/\B(?=(\d{3})+(?!\d))/g, ","), color: "neon-text" },
                { label: "Win Rate", value: `${(Number((data as Record<string, unknown>)?.winRate) || 0).toFixed(1)}%`, color: "neon-green" },
                { label: "Tickers", value: String((data as Record<string, unknown>)?.distinctTickers ?? "—") },
                { label: "Signal Types", value: String((data as Record<string, unknown>)?.signalTypes ?? "—") },
              ].map(s => (
                <div key={s.label} className="panel p-3">
                  <div className="stat-label">{s.label}</div>
                  <div className={cn("stat-value mt-1", s.color || "text-foreground")}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* About */}
            <div className="panel p-3">
              <div className="panel-header mb-2">ABOUT THIS DATA</div>
              <div className="space-y-1.5 text-[11px] text-muted-foreground">
                <p>TREVOR&apos;s training data contains <strong className="text-foreground">synthetic historical trades</strong> across multiple tickers and timeframes. This data was generated to calibrate the signal scoring engine, optimize stop/target placement, and train pattern recognition.</p>
                <p><strong className="text-foreground">Data sources:</strong> Walk-forward backtests on 22 tickers (BTC, ETH, SOL, DOGE, AVAX, LINK, and 16 more) across 4 timeframes (5m, 15m, 1h, 4h).</p>
                <p><strong className="text-foreground">Purpose:</strong> The training bridge uses this data for historical pattern recall during signal evaluation. The confluence scanner references it when scoring entry confidence.</p>
              </div>
            </div>

            {/* Signal Distribution */}
            {(data as Record<string, Array<{ signal_type: string; count: number; win_rate: number }>>)?.signalDistribution && (
              <div className="panel p-3">
                <div className="panel-header mb-2">SIGNAL DISTRIBUTION</div>
                <div className="space-y-0">
                  {((data as Record<string, Array<{ signal_type: string; count: number; win_rate: number }>>).signalDistribution || []).slice(0, 10).map(s => (
                    <div key={s.signal_type} className="flex items-center gap-2 data-cell">
                      <span className="w-32 md:w-40 truncate font-bold text-[11px]">{s.signal_type}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-[rgba(255,255,255,0.04)]">
                        <div className="h-full rounded-full bg-[var(--neon-cyan)] opacity-60" style={{ width: `${Math.min(100, (s.count / ((data as Record<string, Array<{ count: number }>>).signalDistribution?.[0]?.count || 1)) * 100)}%` }} />
                      </div>
                      <span className="w-14 text-right font-mono text-muted-foreground text-[10px]">{s.count.toLocaleString()}</span>
                      <span className={cn("w-10 text-right font-mono font-bold text-[10px]", s.win_rate >= 50 ? "neon-green" : "neon-red")}>{s.win_rate.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Timeframe Distribution */}
            {(data as Record<string, Array<{ timeframe: string; count: number }>>)?.timeframeDistribution && (
              <div className="panel p-3">
                <div className="panel-header mb-2">TIMEFRAME DISTRIBUTION</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {((data as Record<string, Array<{ timeframe: string; count: number }>>).timeframeDistribution || []).map(t => (
                    <div key={t.timeframe} className="panel p-2 text-center">
                      <div className="text-[10px] font-bold neon-text">{t.timeframe}</div>
                      <div className="text-[11px] font-mono text-muted-foreground mt-0.5">{t.count.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
