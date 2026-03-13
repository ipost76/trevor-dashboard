"use client";
import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Lock, RefreshCcw, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";

type BrainStat = { exists: boolean; modified: string; size: number };
type MemoryData = {
  heartbeat: string;
  memorySummary: string;
  dailyFiles: string[];
  brainStats: Record<string, BrainStat>;
  patternCount: number;
  kbCount: number;
};

const PIPELINE_EVENTS = [
  { trigger: "Every Trade Close", desc: "trade_outcomes row + ChromaDB trade-learnings vector", color: "var(--neon-green)" },
  { trigger: "Every 10 Trades", desc: "Pattern summary → ChromaDB trade_patterns collection", color: "var(--neon-green)" },
  { trigger: "Every 30 Minutes", desc: "HEARTBEAT.md auto-updated with system state", color: "var(--neon-cyan)" },
  { trigger: "4:30pm ET Daily", desc: "Daily memory file generated (brain/memory/YYYY-MM-DD.md)", color: "var(--neon-cyan)" },
  { trigger: "4:15pm ET Weekdays", desc: "EOD Review — day's performance posted to #alerts", color: "var(--neon-amber)" },
  { trigger: "Sunday 6am UTC", desc: "Weekly MEMORY.md distillation via Haiku (~$0.01)", color: "#8855ff" },
  { trigger: "Session Start", desc: "Brain files loaded: IDENTITY, BRAIN, SOUL, AGENTS, MEMORY, HEARTBEAT", color: "var(--muted-foreground)" },
  { trigger: "Every Signal", desc: "Synthesis queries: training patterns + trade history + KB context", color: "var(--neon-cyan)" },
];

const SACRED = ["IDENTITY.md", "BRAIN.md", "SOUL.md", "AGENTS.md"];

function formatDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " +
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export default function MemoryPage() {
  const [data, setData] = useState<MemoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    const raw = await safeFetch<MemoryData | null>("/api/memory", null);
    if (raw) setData(raw);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const loadDailyFile = async (filename: string) => {
    const date = filename.replace(".md", "");
    if (expandedFile === filename) { setExpandedFile(null); return; }
    setExpandedFile(filename);
    if (fileContent[filename]) return;
    const res = await safeFetch<{ content: string } | null>(`/api/memory/daily/${date}`, null);
    if (res?.content) setFileContent(prev => ({ ...prev, [filename]: res.content }));
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <RefreshCw className="h-5 w-5 animate-spin text-[var(--neon-cyan)]" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-3">
      <div className="panel-header mb-3">MEMORY PIPELINE</div>

      {/* Pipeline Flow */}
      <div className="panel mb-3">
        <div className="panel-header">PIPELINE EVENTS</div>
        <div className="p-3 space-y-1.5">
          {PIPELINE_EVENTS.map((e, i) => (
            <div key={i} className="flex items-start gap-3">
              <div
                className="w-2 h-2 rounded-full mt-1 shrink-0"
                style={{ backgroundColor: e.color, boxShadow: `0 0 6px ${e.color}` }}
              />
              <div className="flex-1 min-w-0">
                <span className="text-[10px] font-bold" style={{ color: e.color }}>{e.trigger}</span>
                <span className="text-[10px] text-muted-foreground ml-2">{e.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        {/* Brain File Status */}
        <div className="panel">
          <div className="panel-header">BRAIN FILE STATUS</div>
          <div className="p-3 space-y-1">
            {Object.entries(data?.brainStats || {}).map(([name, stat]) => {
              const isSacred = SACRED.includes(name);
              return (
                <div key={name} className="flex items-center gap-2 data-cell">
                  {isSacred ? (
                    <Lock className="h-3 w-3 text-[var(--neon-amber)] shrink-0" />
                  ) : (
                    <RefreshCcw className="h-3 w-3 text-[var(--neon-cyan)] shrink-0" />
                  )}
                  <span className="text-[11px] font-bold text-foreground flex-1">{name}</span>
                  <span className="text-[9px] text-muted-foreground">
                    {stat.exists ? formatDate(stat.modified) : "NOT FOUND"}
                  </span>
                  {stat.exists && (
                    <span className="text-[8px] text-muted-foreground w-12 text-right">
                      {(stat.size / 1024).toFixed(1)}KB
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Collection Stats */}
        <div className="panel">
          <div className="panel-header">VECTOR MEMORY</div>
          <div className="p-3 space-y-2">
            <div className="flex items-center justify-between data-cell">
              <span className="text-[11px] text-foreground">trade_patterns</span>
              <span className="text-[14px] font-bold neon-text">{data?.patternCount || 0}</span>
            </div>
            <div className="flex items-center justify-between data-cell">
              <span className="text-[11px] text-foreground">knowledge_base</span>
              <span className="text-[14px] font-bold neon-text">{data?.kbCount || 0}</span>
            </div>
            <div className="text-[9px] text-muted-foreground mt-2 pt-2 border-t border-[var(--border)]">
              ChromaDB collections with SentenceTransformer embeddings (all-MiniLM-L6-v2)
            </div>
          </div>
        </div>
      </div>

      {/* MEMORY.md Preview */}
      {data?.memorySummary && (
        <div className="panel mb-3">
          <div className="panel-header">MEMORY.md PREVIEW</div>
          <div className="p-3 max-h-[400px] overflow-auto">
            <pre className="text-[10px] text-foreground whitespace-pre-wrap leading-relaxed font-mono">
              {data.memorySummary}
            </pre>
          </div>
        </div>
      )}

      {/* HEARTBEAT.md */}
      {data?.heartbeat && (
        <div className="panel mb-3">
          <div className="panel-header">HEARTBEAT.md</div>
          <div className="p-3 max-h-[300px] overflow-auto">
            <pre className="text-[10px] text-foreground whitespace-pre-wrap leading-relaxed font-mono">
              {data.heartbeat}
            </pre>
          </div>
        </div>
      )}

      {/* Daily Memory Files */}
      <div className="panel">
        <div className="panel-header">DAILY MEMORY FILES</div>
        <div className="p-3 space-y-0.5">
          {(data?.dailyFiles || []).length === 0 ? (
            <div className="text-[10px] text-muted-foreground text-center py-4">No daily memory files found</div>
          ) : (
            data?.dailyFiles.map(f => (
              <div key={f}>
                <div
                  onClick={() => loadDailyFile(f)}
                  className="flex items-center gap-2 data-cell cursor-pointer hover:bg-[rgba(0,240,255,0.03)]"
                >
                  {expandedFile === f ? (
                    <ChevronDown className="h-3 w-3 text-[var(--neon-cyan)] shrink-0" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  )}
                  <span className="text-[11px] font-bold text-foreground">{f.replace(".md", "")}</span>
                </div>
                {expandedFile === f && (
                  <div className="ml-5 p-2 border-l-2 border-[rgba(0,240,255,0.15)] mb-2">
                    {fileContent[f] ? (
                      <pre className="text-[10px] text-foreground whitespace-pre-wrap leading-relaxed font-mono max-h-[300px] overflow-auto">
                        {fileContent[f]}
                      </pre>
                    ) : (
                      <RefreshCw className="h-3 w-3 animate-spin text-[var(--neon-cyan)]" />
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
