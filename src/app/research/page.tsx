"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Search, RefreshCw, ChevronLeft, ChevronRight,
  TrendingUp, TrendingDown, BarChart3, AlertCircle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";

type Tab = "analyses" | "insights" | "quick";

type Analysis = {
  id: number; ticker: string; analysis_type: string;
  synthesis: string; created_at: string; cost_usd?: number;
  tokens_used?: number;
};
type Insight = { id: string; content: string; collection: string; score: number };
type Indicator = { name: string; value: number; signal: string };

export default function ResearchPage() {
  const [tab, setTab] = useState<Tab>("analyses");
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [tickerInput, setTickerInput] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchAnalyses = useCallback(async () => {
    setLoading(true);
    const d = await safeFetch<{ analyses?: Analysis[]; total?: number }>(`/api/research?scope=analyses&page=${page}&pageSize=20`, {});
    setAnalyses(d.analyses || []);
    setTotal(d.total || 0);
    setLoading(false);
  }, [page]);

  const searchInsights = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    const d = await safeFetch<{ results?: Insight[] }>(`/api/research?scope=insights&q=${encodeURIComponent(searchQuery)}`, {});
    setInsights(d.results || []);
    setLoading(false);
  }, [searchQuery]);

  const quickAnalysis = useCallback(async () => {
    if (!tickerInput.trim()) return;
    setLoading(true);
    const d = await safeFetch<{ indicators?: Indicator[] }>(`/api/research?scope=quick&ticker=${tickerInput.toUpperCase()}`, {});
    setIndicators(d.indicators || []);
    setLoading(false);
  }, [tickerInput]);

  useEffect(() => { if (tab === "analyses") fetchAnalyses(); }, [tab, fetchAnalyses]);

  const tabs = [
    { key: "analyses" as Tab, label: "ANALYSES", icon: BarChart3 },
    { key: "insights" as Tab, label: "VECTOR SEARCH", icon: Search },
    { key: "quick" as Tab, label: "QUICK ANALYSIS", icon: TrendingUp },
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

        <div className="flex-1 overflow-auto">
          {/* Analyses */}
          {tab === "analyses" && (
            <>
              {loading ? (
                <div className="flex items-center justify-center py-12"><RefreshCw className="h-5 w-5 animate-spin text-[var(--neon-cyan)]" /></div>
              ) : (
                <div className="space-y-0">
                  {analyses.map(a => (
                    <div key={a.id}>
                      <div
                        onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}
                        className="flex items-center gap-2 data-cell cursor-pointer hover:bg-[rgba(0,240,255,0.03)]"
                      >
                        <span className="w-16 font-bold truncate">{a.ticker}</span>
                        <span className="badge-regime">{a.analysis_type}</span>
                        <span className="flex-1 text-muted-foreground truncate text-[10px]">{a.synthesis?.slice(0, 80)}...</span>
                        <span className="w-20 text-right text-[9px] text-muted-foreground">{a.created_at ? new Date(a.created_at).toLocaleDateString() : ""}</span>
                      </div>
                      {expandedId === a.id && (
                        <div className="px-4 py-3 bg-[rgba(0,240,255,0.02)] border-b border-[var(--border)]">
                          <pre className="text-[11px] text-foreground whitespace-pre-wrap font-mono">{a.synthesis}</pre>
                          {a.cost_usd && <div className="mt-2 text-[9px] text-muted-foreground">Cost: ${a.cost_usd.toFixed(4)} | Tokens: {a.tokens_used}</div>}
                        </div>
                      )}
                    </div>
                  ))}
                  {total > 20 && (
                    <div className="flex items-center justify-center gap-3 py-2 border-t border-[var(--border)]">
                      <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="btn-primary disabled:opacity-30"><ChevronLeft className="h-3 w-3" /></button>
                      <span className="text-[10px] text-muted-foreground">{page} / {Math.ceil(total / 20)}</span>
                      <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / 20)} className="btn-primary disabled:opacity-30"><ChevronRight className="h-3 w-3" /></button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Vector Search */}
          {tab === "insights" && (
            <div className="p-3 space-y-3">
              <div className="flex items-center gap-2">
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && searchInsights()}
                  placeholder="Search training data, patterns, lessons..."
                  className="input-terminal flex-1"
                />
                <button onClick={searchInsights} disabled={loading} className="btn-primary flex items-center gap-1">
                  <Search className="h-3 w-3" /> SEARCH
                </button>
              </div>
              {loading && <div className="flex justify-center py-8"><RefreshCw className="h-5 w-5 animate-spin text-[var(--neon-cyan)]" /></div>}
              {insights.map((ins, i) => (
                <div key={i} className="panel p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="badge-regime">{ins.collection}</span>
                    <span className="text-[10px] font-mono neon-text">{(ins.score * 100).toFixed(1)}% match</span>
                  </div>
                  <p className="text-[11px] text-foreground whitespace-pre-wrap">{ins.content}</p>
                </div>
              ))}
            </div>
          )}

          {/* Quick Analysis */}
          {tab === "quick" && (
            <div className="p-3 space-y-3">
              <div className="flex items-center gap-2">
                <input
                  value={tickerInput}
                  onChange={e => setTickerInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && quickAnalysis()}
                  placeholder="Enter ticker (e.g. BTC, AAPL)"
                  className="input-terminal w-48"
                />
                <button onClick={quickAnalysis} disabled={loading} className="btn-primary flex items-center gap-1">
                  <BarChart3 className="h-3 w-3" /> ANALYZE
                </button>
              </div>
              {loading && <div className="flex justify-center py-8"><RefreshCw className="h-5 w-5 animate-spin text-[var(--neon-cyan)]" /></div>}
              {indicators.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {indicators.map((ind, i) => (
                    <div key={i} className="panel p-3">
                      <div className="stat-label">{ind.name}</div>
                      <div className="stat-value mt-1">{typeof ind.value === "number" ? ind.value.toFixed(2) : ind.value}</div>
                      <div className={cn(
                        "text-[10px] mt-1 font-bold",
                        ind.signal === "bullish" ? "neon-green" : ind.signal === "bearish" ? "neon-red" : "text-muted-foreground"
                      )}>
                        {ind.signal?.toUpperCase()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
