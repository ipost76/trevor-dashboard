"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { Search, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";

type LogEntry = { timestamp: string; level: string; message: string; raw: string };

const LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];
const LEVEL_COLORS: Record<string, string> = {
  DEBUG: "text-muted-foreground",
  INFO: "text-[var(--neon-cyan)]",
  WARNING: "neon-amber",
  ERROR: "neon-red",
  CRITICAL: "neon-magenta",
};

export function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeLevels, setActiveLevels] = useState(new Set(["INFO", "WARNING", "ERROR", "CRITICAL"]));
  const [autoRefresh, setAutoRefresh] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    const levels = Array.from(activeLevels).join(",");
    const d = await safeFetch<{ entries?: LogEntry[] }>(`/api/logs?levels=${levels}&search=${encodeURIComponent(search)}&limit=500`, {});
    setLogs(d.entries || []);
    setLoading(false);
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 50);
  }, [activeLevels, search]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (autoRefresh <= 0) return;
    const i = setInterval(fetchLogs, autoRefresh * 1000);
    return () => clearInterval(i);
  }, [autoRefresh, fetchLogs]);

  const toggleLevel = (level: string) => {
    setActiveLevels(prev => {
      const next = new Set(prev);
      next.has(level) ? next.delete(level) : next.add(level);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap p-2 border-b border-[var(--border)]">
        {LEVELS.map(l => (
          <button
            key={l}
            onClick={() => toggleLevel(l)}
            className={cn(
              "px-2 py-0.5 rounded text-[8px] font-bold tracking-wide border transition-colors",
              activeLevels.has(l)
                ? `${LEVEL_COLORS[l]} border-current bg-current/10`
                : "text-muted-foreground border-transparent opacity-40"
            )}
          >
            {l}
          </button>
        ))}
        <div className="h-3 w-px bg-[var(--border)]" />
        <select
          value={autoRefresh}
          onChange={e => setAutoRefresh(Number(e.target.value))}
          className="input-terminal text-[9px] py-0.5 px-1"
        >
          <option value={0}>Manual</option>
          <option value={5}>5s</option>
          <option value={15}>15s</option>
          <option value={30}>30s</option>
        </select>
        <button onClick={fetchLogs} className="text-muted-foreground hover:text-[var(--neon-cyan)] transition-colors">
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        </button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--border)] bg-[rgba(0,240,255,0.02)]">
        <Search className="h-3 w-3 text-muted-foreground" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter logs..."
          className="bg-transparent border-none outline-none text-[11px] flex-1 text-foreground placeholder:text-muted-foreground"
        />
        {search && (
          <button onClick={() => setSearch("")} className="text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        )}
        <span className="text-[9px] text-muted-foreground">{logs.length} entries</span>
      </div>

      {/* Log Output */}
      <div ref={scrollRef} className="flex-1 overflow-auto bg-[#08080d] p-2 font-mono text-[10px] leading-relaxed">
        {logs.map((entry, i) => (
          <div key={i} className={cn(
            "px-1 py-0.5 hover:bg-[rgba(255,255,255,0.02)] rounded-sm",
            LEVEL_COLORS[entry.level] || "text-muted-foreground"
          )}>
            <span className="text-muted-foreground opacity-60">{entry.timestamp} </span>
            <span className="font-bold">[{entry.level}] </span>
            <span>{entry.message}</span>
          </div>
        ))}
        {logs.length === 0 && !loading && (
          <div className="text-center py-8 text-muted-foreground">No log entries match filters</div>
        )}
      </div>
    </div>
  );
}
