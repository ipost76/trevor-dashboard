"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";

interface HeartbeatParsed {
  last_active: string;
  signals_today: number;
  trades_closed: number;
  api_budget: string;
  alive_status: "alive" | "warn" | "dead";
  raw: string;
}
interface MemorySection { title: string; content: string; }
interface VaultData {
  syncTimerActive: boolean;
  dailyFileCount: number;
  dailyFiles: string[];
  heartbeat: HeartbeatParsed | null;
  memorySections: MemorySection[];
  memoryContent: string;
  heartbeatContent: string;
}

export function VaultTab() {
  const [data, setData] = useState<VaultData | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set([0]));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dailyContent, setDailyContent] = useState<Record<string, string>>({});
  const dateScrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    safeFetch<VaultData>("/api/ghost", {
      syncTimerActive: false, dailyFileCount: 0, dailyFiles: [],
      heartbeat: null, memorySections: [], memoryContent: "", heartbeatContent: "",
    }).then(d => {
      setData(d);
      if (!selectedDate && d.dailyFiles.length > 0) {
        setSelectedDate(d.dailyFiles[0].replace(".md", ""));
      }
    });
  }, [selectedDate]);
  useEffect(() => { load(); const iv = setInterval(load, 60000); return () => clearInterval(iv); }, [load]);

  const loadDaily = async (date: string) => {
    setSelectedDate(date);
    if (!dailyContent[date]) {
      const r = await safeFetch<{ content: string }>(`/api/ghost/daily/${date}`, { content: "" });
      setDailyContent(p => ({ ...p, [date]: r.content }));
    }
  };

  const toggleSection = (idx: number) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  if (!data) return <div className="text-muted-foreground text-xs p-8">Loading vault...</div>;

  const hb = data.heartbeat;
  const aliveColor = hb?.alive_status === "alive" ? "bg-green-400 shadow-[0_0_6px_rgba(0,255,136,0.5)]"
    : hb?.alive_status === "warn" ? "bg-amber-400 shadow-[0_0_6px_rgba(255,170,0,0.5)]"
    : "bg-red-400 shadow-[0_0_6px_rgba(255,68,68,0.5)]";
  const aliveText = hb?.alive_status === "alive" ? "ALIVE" : hb?.alive_status === "warn" ? "IDLE" : "OFFLINE";
  const aliveTextColor = hb?.alive_status === "alive" ? "neon-green" : hb?.alive_status === "warn" ? "neon-amber" : "neon-red";

  const sections = data.memorySections.length > 0 ? data.memorySections : [];
  const dateRange = data.dailyFiles.length > 0
    ? `${data.dailyFiles[data.dailyFiles.length - 1]?.replace(".md", "").slice(5)} \u2013 ${data.dailyFiles[0]?.replace(".md", "").slice(5)}`
    : "";

  return (
    <div className="space-y-3 overflow-y-auto pb-32">
      {/* ── Sync Status Bar ── */}
      <div className="flex items-center gap-3 px-3 py-2 rounded bg-[#141a24] border-l-[3px]"
        style={{ borderLeftColor: data.syncTimerActive ? "#00ff88" : "#ff4444" }}>
        <div className={cn("h-2 w-2 rounded-full shrink-0", data.syncTimerActive ? "bg-green-400 shadow-[0_0_6px_rgba(0,255,136,0.5)]" : "bg-red-400")} />
        <span className="text-[11px] uppercase tracking-[0.1em] font-bold text-foreground">{data.syncTimerActive ? "SYNC ACTIVE" : "SYNC INACTIVE"}</span>
        <span className="text-[10px] text-muted-foreground">{data.dailyFileCount} files</span>
        {dateRange && <span className="text-[10px] text-muted-foreground">{dateRange}</span>}
      </div>

      {/* ── Heartbeat Cards ── */}
      <div className="panel p-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] uppercase tracking-[0.15em] font-bold text-muted-foreground">TREVOR Heartbeat</span>
          <div className="flex items-center gap-1.5">
            <div className={cn("h-2 w-2 rounded-full", aliveColor)} />
            <span className={cn("text-[10px] font-bold uppercase", aliveTextColor)}>{aliveText}</span>
          </div>
        </div>
        {hb ? (
          <div className="grid grid-cols-2 gap-2">
            <MetricCard label="LAST ACTIVE" value={hb.last_active || "\u2014"} />
            <MetricCard label="SIGNALS" value={`${hb.signals_today} today`} />
            <MetricCard label="TRADES" value={`${hb.trades_closed} closed`} />
            <MetricCard label="API BUDGET" value={hb.api_budget || "$0.00"} />
          </div>
        ) : (
          <pre className="text-[10px] leading-relaxed text-muted-foreground max-h-[200px] overflow-y-auto whitespace-pre-wrap">{data.heartbeatContent}</pre>
        )}
      </div>

      {/* ── Memory Sections ── */}
      {sections.length > 0 ? (
        <div className="panel p-3">
          <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-muted-foreground mb-2">TREVOR Memory</div>
          <div className="space-y-1">
            {sections.map((sec, i) => (
              <div key={i} className="rounded border border-[rgba(0,240,255,0.06)]">
                <button
                  onClick={() => toggleSection(i)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[rgba(0,240,255,0.03)] transition-colors"
                >
                  {expandedSections.has(i) ? <ChevronDown className="h-3 w-3 neon-text shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                  <span className="text-xs font-bold tracking-wider uppercase neon-text">{sec.title}</span>
                </button>
                {expandedSections.has(i) && (
                  <div className="px-3 pb-3 max-h-[200px] overflow-y-auto">
                    <pre className="text-[10px] leading-relaxed text-muted-foreground whitespace-pre-wrap">{sec.content}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : data.memoryContent ? (
        <div className="panel p-3">
          <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-muted-foreground mb-2">TREVOR Memory</div>
          <pre className="text-[10px] leading-relaxed text-muted-foreground max-h-[300px] overflow-y-auto whitespace-pre-wrap bg-[#0a0a12] p-3 rounded">{data.memoryContent}</pre>
        </div>
      ) : null}

      {/* ── Daily Memory Timeline ── */}
      {data.dailyFiles.length > 0 && (
        <div className="panel p-3">
          <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-muted-foreground mb-2">Daily Memory Timeline</div>
          <div ref={dateScrollRef} className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1" style={{ WebkitOverflowScrolling: "touch" }}>
            {data.dailyFiles.map(f => {
              const date = f.replace(".md", "");
              const isActive = selectedDate === date;
              const label = date.slice(5); // "03-30"
              return (
                <button
                  key={date}
                  onClick={() => loadDaily(date)}
                  className={cn(
                    "px-2.5 py-1.5 rounded text-[10px] font-mono font-bold whitespace-nowrap shrink-0 transition-colors",
                    isActive
                      ? "bg-[#00ff88] text-[#06060b]"
                      : "bg-[#141a24] text-muted-foreground hover:text-foreground hover:bg-[rgba(0,240,255,0.06)]"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {selectedDate && (
            <div className="mt-2 max-h-[300px] overflow-y-auto bg-[#0a0a12] p-3 rounded">
              <pre className="text-[10px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                {dailyContent[selectedDate] || "Loading..."}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0a0f14] rounded p-2.5 border border-[rgba(0,240,255,0.06)]">
      <div className="text-[8px] uppercase tracking-[0.15em] text-muted-foreground mb-1">{label}</div>
      <div className="text-sm font-bold font-mono text-foreground">{value}</div>
    </div>
  );
}
