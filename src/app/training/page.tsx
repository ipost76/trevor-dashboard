"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Database, TrendingUp, TrendingDown, CheckCircle, XCircle,
  RefreshCw, ChevronLeft, ChevronRight, Search, BookOpen, BarChart3
} from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";

type Tab = "overview" | "records" | "vectors";

export default function TrainingPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState({ ticker: "", signal: "", version: "" });
  const [searchQuery, setSearchQuery] = useState("");
  const [vectorResults, setVectorResults] = useState<Record<string, unknown>[]>([]);
  const pageSize = 30;

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    const d = await safeFetch<Record<string, unknown>>("/api/training?scope=summary", {});
    setData(Object.keys(d).length > 0 ? d : null);
    setLoading(false);
  }, []);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ scope: "records", page: String(page), pageSize: String(pageSize) });
    if (filter.ticker) params.set("ticker", filter.ticker);
    if (filter.signal) params.set("signal", filter.signal);
    if (filter.version) params.set("version", filter.version);
    const d = await safeFetch<{ records?: Record<string, unknown>[]; total?: number }>(`/api/training?${params}`, {});
    setRecords(d.records || []);
    setTotal(d.total || 0);
    setLoading(false);
  }, [page, filter]);

  const searchVectors = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    const d = await safeFetch<{ results?: Record<string, unknown>[] }>(`/api/training?scope=chroma&q=${encodeURIComponent(searchQuery)}`, {});
    setVectorResults(d.results || []);
    setLoading(false);
  }, [searchQuery]);

  useEffect(() => {
    if (tab === "overview") fetchOverview();
    else if (tab === "records") fetchRecords();
  }, [tab, fetchOverview, fetchRecords]);

  const tabs = [
    { key: "overview" as Tab, label: "OVERVIEW", icon: BarChart3 },
    { key: "records" as Tab, label: "RECORDS", icon: Database },
    { key: "vectors" as Tab, label: "VECTORS", icon: Search },
  ];

  return (
    <div className="flex-1 overflow-auto p-2">
      <div className="panel h-full flex flex-col">
        <div className="flex items-center border-b border-[var(--border)] bg-[var(--panel-header)]">
          {tabs.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] transition-colors border-b-2",
                  tab === t.key
                    ? "text-[var(--neon-cyan)] border-[var(--neon-cyan)]"
                    : "text-muted-foreground border-transparent hover:text-foreground"
                )}
              >
                <Icon className="h-3 w-3" />
                {t.label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <RefreshCw className="h-5 w-5 animate-spin text-[var(--neon-cyan)]" />
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            {/* Overview */}
            {tab === "overview" && data && (
              <div className="p-3 space-y-4">
                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[
                    { label: "Total Trades", value: String((data as Record<string, unknown>).totalTrades ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, ","), color: "neon-text" },
                    { label: "Signal Types", value: String((data as Record<string, unknown>).signalTypes ?? 0) },
                    { label: "Versions", value: ((data as Record<string, string[]>).versions || []).join(", ") },
                    { label: "Win Rate", value: `${((data as Record<string, number>).winRate ?? 0).toFixed(1)}%`, color: "neon-green" },
                  ].map(s => (
                    <div key={s.label} className="panel p-3">
                      <div className="stat-label">{s.label}</div>
                      <div className={cn("stat-value mt-1", s.color || "text-foreground")}>{s.value}</div>
                    </div>
                  ))}
                </div>

                {/* Signal Distribution */}
                {(data as Record<string, Array<{ signal_type: string; count: number; win_rate: number }>>).signalDistribution && (
                  <div>
                    <div className="panel-header mb-1">SIGNAL DISTRIBUTION</div>
                    <div className="space-y-0">
                      {((data as Record<string, Array<{ signal_type: string; count: number; win_rate: number }>>).signalDistribution || []).slice(0, 15).map(s => (
                        <div key={s.signal_type} className="flex items-center gap-2 data-cell">
                          <span className="w-40 truncate font-bold text-[11px]">{s.signal_type}</span>
                          <div className="flex-1 h-1.5 rounded-full bg-[rgba(255,255,255,0.04)]">
                            <div className="h-full rounded-full bg-[var(--neon-cyan)] opacity-60" style={{ width: `${Math.min(100, (s.count / ((data as Record<string, Array<{ count: number }>>).signalDistribution?.[0]?.count || 1)) * 100)}%` }} />
                          </div>
                          <span className="w-16 text-right font-mono text-muted-foreground">{s.count.toLocaleString()}</span>
                          <span className={cn("w-12 text-right font-mono font-bold", s.win_rate >= 50 ? "neon-green" : "neon-red")}>{s.win_rate.toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Timeframe Distribution */}
                {(data as Record<string, Array<{ timeframe: string; count: number }>>).timeframeDistribution && (
                  <div>
                    <div className="panel-header mb-1">TIMEFRAME DISTRIBUTION</div>
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
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

            {/* Records */}
            {tab === "records" && (
              <>
                {/* Filters */}
                <div className="flex items-center gap-2 p-2 border-b border-[var(--border)] bg-[var(--panel-header)]">
                  <input value={filter.ticker} onChange={e => setFilter(f => ({ ...f, ticker: e.target.value }))} placeholder="Ticker" className="input-terminal w-24" />
                  <input value={filter.signal} onChange={e => setFilter(f => ({ ...f, signal: e.target.value }))} placeholder="Signal type" className="input-terminal w-32" />
                  <input value={filter.version} onChange={e => setFilter(f => ({ ...f, version: e.target.value }))} placeholder="Version" className="input-terminal w-20" />
                  <button onClick={() => { setPage(1); fetchRecords(); }} className="btn-primary">FILTER</button>
                  <span className="text-[9px] text-muted-foreground ml-auto">{total.toLocaleString()} records</span>
                </div>

                {/* Table header */}
                <div className="flex items-center gap-1 px-2 py-1 border-b border-[var(--border)] text-[8px] font-bold uppercase tracking-[0.1em] text-muted-foreground bg-[var(--panel-header)]">
                  <span className="w-14">Ticker</span>
                  <span className="w-10">Dir</span>
                  <span className="w-24">Signal</span>
                  <span className="w-8">TF</span>
                  <span className="w-10 text-right">Conf</span>
                  <span className="w-10 text-right">R:R</span>
                  <span className="w-12 text-right">P&L</span>
                  <span className="w-10 text-center">Result</span>
                  <span className="flex-1">Lesson</span>
                </div>

                {/* Rows */}
                <div className="overflow-auto">
                  {records.map((r, i) => {
                    const pnl = Number(r.pnl_pct ?? 0);
                    const isWin = String(r.outcome_result) === "win";
                    return (
                      <div key={i} className="flex items-center gap-1 data-cell hover:bg-[rgba(0,240,255,0.03)] text-[10px]">
                        <span className="w-14 font-bold truncate">{String(r.ticker)}</span>
                        <span className="w-10"><span className={String(r.direction) === "long" ? "badge-long" : "badge-short"}>{String(r.direction).toUpperCase().slice(0, 1)}</span></span>
                        <span className="w-24 text-muted-foreground truncate">{String(r.signal_type)}</span>
                        <span className="w-8 text-muted-foreground">{String(r.timeframe)}</span>
                        <span className="w-10 text-right font-mono">{Number(r.confidence ?? 0).toFixed(0)}%</span>
                        <span className="w-10 text-right font-mono text-muted-foreground">{Number(r.rr_ratio ?? 0).toFixed(1)}</span>
                        <span className={cn("w-12 text-right font-mono font-bold", pnl >= 0 ? "neon-green" : "neon-red")}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(1)}%</span>
                        <span className="w-10 flex justify-center">{isWin ? <CheckCircle className="h-3 w-3 text-[var(--neon-green)]" /> : <XCircle className="h-3 w-3 text-[var(--neon-red)]" />}</span>
                        <span className="flex-1 text-muted-foreground truncate">{String(r.lesson || "")}</span>
                      </div>
                    );
                  })}
                </div>

                {total > pageSize && (
                  <div className="flex items-center justify-center gap-3 py-2 border-t border-[var(--border)]">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="btn-primary disabled:opacity-30"><ChevronLeft className="h-3 w-3" /></button>
                    <span className="text-[10px] text-muted-foreground">{page} / {Math.ceil(total / pageSize)}</span>
                    <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / pageSize)} className="btn-primary disabled:opacity-30"><ChevronRight className="h-3 w-3" /></button>
                  </div>
                )}
              </>
            )}

            {/* Vectors */}
            {tab === "vectors" && (
              <div className="p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && searchVectors()}
                    placeholder="Search training patterns, lessons..."
                    className="input-terminal flex-1"
                  />
                  <button onClick={searchVectors} className="btn-primary flex items-center gap-1"><Search className="h-3 w-3" /> SEARCH</button>
                </div>
                {vectorResults.map((r, i) => (
                  <div key={i} className="panel p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="badge-regime">{String(r.collection)}</span>
                      <span className="text-[10px] font-mono neon-text">{((Number(r.score) || 0) * 100).toFixed(1)}%</span>
                    </div>
                    <p className="text-[11px] text-foreground whitespace-pre-wrap">{String(r.content)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
