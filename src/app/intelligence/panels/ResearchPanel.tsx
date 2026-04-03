"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Search, RefreshCw, ChevronLeft, ChevronRight,
  TrendingUp, BarChart3, Database, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { TabBar, type TabDef } from "@/components/ui/tab-bar";
import { EmptyState } from "@/components/ui/empty-state";

type Tab = "analyses" | "insights" | "quick" | "knowledge";

type Analysis = {
  id: number; ticker: string; analysis_type: string;
  synthesis: string; created_at: string; cost_usd?: number; tokens_used?: number;
};
type Insight = { id: string; content: string; collection: string; score: number };
type Indicator = { name: string; value: number; signal: string };
type KBResult = {
  content?: string; source?: string; ingested_at?: string;
  distance?: number; document?: string; metadata?: Record<string, string>;
};

const tabDefs: TabDef<Tab>[] = [
  { key: "analyses", label: "Analyses", icon: BarChart3 },
  { key: "insights", label: "Vector Search", icon: Search },
  { key: "quick", label: "Quick Analysis", icon: TrendingUp },
  { key: "knowledge", label: "Knowledge Base", icon: Database },
];

export default function ResearchPanel() {
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
  // KB state
  const [kbQuery, setKbQuery] = useState("");
  const [kbResults, setKbResults] = useState<KBResult[]>([]);
  const [kbStats, setKbStats] = useState<{ total_entries: number }>({ total_entries: 0 });
  const [kbSearched, setKbSearched] = useState(false);

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

  const fetchKbStats = useCallback(async () => {
    const raw = await safeFetch<{ total_entries: number }>("/api/knowledge/stats", { total_entries: 0 });
    if (raw) setKbStats(raw);
  }, []);

  const searchKb = useCallback(async () => {
    if (!kbQuery.trim()) return;
    setLoading(true);
    setKbSearched(true);
    const raw = await safeFetch<{ results: KBResult[] } | null>(`/api/knowledge/search?q=${encodeURIComponent(kbQuery)}`, null);
    setKbResults(raw?.results || []);
    setLoading(false);
  }, [kbQuery]);

  useEffect(() => {
    if (tab === "analyses") fetchAnalyses();
    if (tab === "knowledge") fetchKbStats();
  }, [tab, fetchAnalyses, fetchKbStats]);

  const getRecencyColor = (dateStr?: string) => {
    if (!dateStr) return "var(--muted-foreground)";
    const days = (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
    if (days <= 7) return "var(--neon-green)";
    if (days <= 30) return "var(--neon-amber)";
    return "var(--muted-foreground)";
  };

  return (
    <div className="flex-1 overflow-auto p-2">
      <div className="panel h-full flex flex-col">
        <TabBar tabs={tabDefs} active={tab} onChange={setTab} />

        <div className="flex-1 overflow-auto">
          {/* ── Analyses ── */}
          {tab === "analyses" && (
            <>
              {loading ? (
                <div className="flex items-center justify-center py-12"><RefreshCw className="h-5 w-5 animate-spin text-[var(--neon-cyan)]" /></div>
              ) : (
                <div className="space-y-0">
                  {analyses.map(a => (
                    <div key={a.id}>
                      <div onClick={() => setExpandedId(expandedId === a.id ? null : a.id)} className="flex items-center gap-2 data-cell cursor-pointer hover:bg-[rgba(0,240,255,0.03)]">
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
                  {analyses.length === 0 && <EmptyState icon={BarChart3} message="No analyses yet" sub="Run your first analysis via Quick Analysis tab or !research in Discord" className="py-12" />}
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

          {/* ── Vector Search ── */}
          {tab === "insights" && (
            <div className="p-3 space-y-3">
              <div className="flex items-center gap-2">
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && searchInsights()} placeholder="Search training data, patterns, lessons..." className="input-terminal flex-1" />
                <button onClick={searchInsights} disabled={loading} className="btn-primary flex items-center gap-1"><Search className="h-3 w-3" /> SEARCH</button>
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

          {/* ── Quick Analysis ── */}
          {tab === "quick" && (
            <div className="p-3 space-y-3">
              <div className="flex items-center gap-2">
                <input value={tickerInput} onChange={e => setTickerInput(e.target.value)} onKeyDown={e => e.key === "Enter" && quickAnalysis()} placeholder="Enter ticker (e.g. BTC, AAPL)" className="input-terminal w-48" />
                <button onClick={quickAnalysis} disabled={loading} className="btn-primary flex items-center gap-1"><BarChart3 className="h-3 w-3" /> ANALYZE</button>
              </div>
              {loading && <div className="flex justify-center py-8"><RefreshCw className="h-5 w-5 animate-spin text-[var(--neon-cyan)]" /></div>}
              {indicators.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {indicators.map((ind, i) => (
                    <div key={i} className="panel p-3">
                      <div className="stat-label">{ind.name}</div>
                      <div className="stat-value mt-1">{typeof ind.value === "number" ? ind.value.toFixed(2) : ind.value}</div>
                      <div className={cn("text-[10px] mt-1 font-bold", ind.signal === "bullish" ? "neon-green" : ind.signal === "bearish" ? "neon-red" : "text-muted-foreground")}>
                        {ind.signal?.toUpperCase()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Knowledge Base ── */}
          {tab === "knowledge" && (
            <div className="p-3 space-y-3">
              <div className="flex items-center gap-4 mb-1">
                <div className="panel px-3 py-2 flex items-center gap-2">
                  <Database className="h-3.5 w-3.5 text-[var(--neon-cyan)]" />
                  <span className="text-[10px] text-muted-foreground">ENTRIES:</span>
                  <span className="text-[12px] font-bold neon-text">{kbStats.total_entries}</span>
                </div>
              </div>

              <div className="panel">
                <div className="p-3 flex gap-2">
                  <input value={kbQuery} onChange={e => setKbQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && searchKb()} placeholder="Search knowledge base..." className="input-terminal flex-1" />
                  <button onClick={searchKb} disabled={loading || !kbQuery.trim()} className="btn-primary flex items-center gap-1.5 disabled:opacity-30">
                    {loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />} SEARCH
                  </button>
                </div>
              </div>

              {kbStats.total_entries === 0 && !kbSearched && (
                <EmptyState icon={Database} message="Knowledge base is empty" sub="Add articles and research via Discord: !kb add <url>" />
              )}

              {kbSearched && (
                <div className="space-y-2">
                  {kbResults.length === 0 && !loading && (
                    <div className="panel p-4 text-center text-[10px] text-muted-foreground">No results found</div>
                  )}
                  {kbResults.map((r, i) => {
                    const content = r.content || r.document || "";
                    const source = r.source || r.metadata?.source || "Unknown";
                    const date = r.ingested_at || r.metadata?.ingested_at || "";
                    return (
                      <div key={i} className="panel" style={{ borderLeftColor: getRecencyColor(date), borderLeftWidth: 3 }}>
                        <div className="p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span className="text-[10px] text-[var(--neon-cyan)] truncate max-w-[300px]">{source}</span>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              {date && <span className="text-[9px] text-muted-foreground">{new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>}
                              {r.distance != null && <span className={cn("text-[9px] font-bold", r.distance < 0.5 ? "neon-green" : r.distance < 1.0 ? "neon-amber" : "neon-red")}>{(1 - r.distance).toFixed(2)} relevance</span>}
                            </div>
                          </div>
                          <div className="text-[10px] text-foreground leading-relaxed">{content.slice(0, 300)}{content.length > 300 ? "..." : ""}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
