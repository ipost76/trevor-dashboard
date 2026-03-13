"use client";
import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Search, Database, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";

type KBResult = {
  content?: string;
  source?: string;
  ingested_at?: string;
  distance?: number;
  document?: string;
  metadata?: Record<string, string>;
};

type KBStats = {
  total_entries: number;
  collection_name?: string;
};

export default function KnowledgePage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KBResult[]>([]);
  const [stats, setStats] = useState<KBStats>({ total_entries: 0 });
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const fetchStats = useCallback(async () => {
    const raw = await safeFetch<KBStats>("/api/knowledge/stats", { total_entries: 0 });
    if (raw) setStats(raw);
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearched(true);
    const raw = await safeFetch<{ results: KBResult[] } | null>(`/api/knowledge/search?q=${encodeURIComponent(query)}`, null);
    setResults(raw?.results || []);
    setSearching(false);
  };

  const getRecencyColor = (dateStr?: string) => {
    if (!dateStr) return "var(--muted-foreground)";
    const days = (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
    if (days <= 7) return "var(--neon-green)";
    if (days <= 30) return "var(--neon-amber)";
    return "var(--muted-foreground)";
  };

  return (
    <div className="flex-1 overflow-auto p-3">
      <div className="panel-header mb-3">KNOWLEDGE BASE</div>

      {/* Stats */}
      <div className="flex items-center gap-4 mb-3">
        <div className="panel px-3 py-2 flex items-center gap-2">
          <Database className="h-3.5 w-3.5 text-[var(--neon-cyan)]" />
          <span className="text-[10px] text-muted-foreground">ENTRIES:</span>
          <span className="text-[12px] font-bold neon-text">{stats.total_entries}</span>
        </div>
      </div>

      {/* Search Bar */}
      <div className="panel mb-4">
        <div className="p-3 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="Search knowledge base..."
            className="input-terminal flex-1"
          />
          <button
            onClick={handleSearch}
            disabled={searching || !query.trim()}
            className="btn-primary flex items-center gap-1.5 disabled:opacity-30"
          >
            {searching ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
            SEARCH
          </button>
        </div>
      </div>

      {/* Empty KB State */}
      {stats.total_entries === 0 && !searched && (
        <div className="panel p-6 text-center">
          <Database className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-30" />
          <div className="text-sm text-muted-foreground">Knowledge base is empty.</div>
          <div className="text-[10px] text-muted-foreground mt-1">
            Use <code className="neon-text">!kb add &lt;url&gt;</code> in Discord to ingest articles.
          </div>
        </div>
      )}

      {/* Results */}
      {searched && (
        <div className="space-y-2">
          {results.length === 0 && !searching && (
            <div className="panel p-4 text-center text-[10px] text-muted-foreground">
              No results found for &quot;{query}&quot;
            </div>
          )}
          {results.map((r, i) => {
            const content = r.content || r.document || "";
            const source = r.source || r.metadata?.source || "Unknown";
            const date = r.ingested_at || r.metadata?.ingested_at || "";
            const distance = r.distance;
            return (
              <div
                key={i}
                className="panel"
                style={{ borderLeftColor: getRecencyColor(date), borderLeftWidth: 3 }}
              >
                <div className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-[10px] text-[var(--neon-cyan)] truncate max-w-[300px]">{source}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {date && (
                        <span className="text-[9px] text-muted-foreground">
                          {new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </span>
                      )}
                      {distance != null && (
                        <span className={cn(
                          "text-[9px] font-bold",
                          distance < 0.5 ? "neon-green" : distance < 1.0 ? "neon-amber" : "neon-red"
                        )}>
                          {(1 - distance).toFixed(2)} relevance
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-[10px] text-foreground leading-relaxed">
                    {content.slice(0, 300)}{content.length > 300 ? "..." : ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
