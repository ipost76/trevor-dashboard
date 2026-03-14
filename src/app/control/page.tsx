"use client";
import { useState, useCallback, useEffect } from "react";
import {
  FileText, Brain, Database, Calendar, Terminal, Shield,
  RefreshCw, ChevronDown, ChevronRight, Lock, RefreshCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { TabBar, type TabDef } from "@/components/ui/tab-bar";
import { BrainEditor } from "@/components/control/brain-editor";
import { ChromaBrowser } from "@/components/control/chroma-browser";
import { ScheduleManager } from "@/components/control/schedule-manager";
import { LogViewer } from "@/components/control/log-viewer";
import { SecurityViewer } from "@/components/control/security-viewer";
import { EmptyState } from "@/components/ui/empty-state";

type Tab = "brain" | "memory" | "chroma" | "schedule" | "logs" | "security";

const tabDefs: TabDef<Tab>[] = [
  { key: "brain", label: "Brain Files", icon: FileText },
  { key: "memory", label: "Memory", icon: Brain },
  { key: "chroma", label: "ChromaDB", icon: Database },
  { key: "schedule", label: "Schedule", icon: Calendar },
  { key: "logs", label: "Logs", icon: Terminal },
  { key: "security", label: "Security", icon: Shield },
];

type MemoryData = {
  heartbeat: string;
  memorySummary: string;
  dailyFiles: string[];
  brainStats: Record<string, { exists: boolean; modified: string; size: number }>;
  patternCount: number;
  kbCount: number;
};

const SACRED = ["IDENTITY.md", "BRAIN.md", "SOUL.md", "AGENTS.md"];

function formatDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " +
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export default function ControlPage() {
  const [tab, setTab] = useState<Tab>("brain");

  return (
    <div className="flex-1 overflow-hidden p-2">
      <div className="panel h-full flex flex-col">
        <TabBar tabs={tabDefs} active={tab} onChange={setTab} />
        <div className="flex-1 overflow-auto">
          {tab === "brain" && <BrainEditor />}
          {tab === "memory" && <MemoryTab />}
          {tab === "chroma" && <ChromaBrowser />}
          {tab === "schedule" && <ScheduleManager />}
          {tab === "logs" && <LogViewer />}
          {tab === "security" && <SecurityViewer />}
        </div>
      </div>
    </div>
  );
}

/* ── Memory Tab (inline) ── */
function MemoryTab() {
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
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-5 w-5 animate-spin text-[var(--neon-cyan)]" />
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3 overflow-auto">
      {/* Brain File Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="panel">
          <div className="panel-header">BRAIN FILE STATUS</div>
          <div className="p-3 space-y-1">
            {Object.entries(data?.brainStats || {}).map(([name, stat]) => {
              const isSacred = SACRED.includes(name);
              return (
                <div key={name} className="flex items-center gap-2 data-cell">
                  {isSacred ? <Lock className="h-3 w-3 text-[var(--neon-amber)] shrink-0" /> : <RefreshCcw className="h-3 w-3 text-[var(--neon-cyan)] shrink-0" />}
                  <span className="text-[11px] font-bold text-foreground flex-1">{name}</span>
                  <span className="text-[9px] text-muted-foreground">{stat.exists ? formatDate(stat.modified) : "NOT FOUND"}</span>
                  {stat.exists && <span className="text-[8px] text-muted-foreground w-12 text-right">{(stat.size / 1024).toFixed(1)}KB</span>}
                </div>
              );
            })}
          </div>
        </div>

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
          </div>
        </div>
      </div>

      {/* MEMORY.md Preview */}
      {data?.memorySummary && (
        <div className="panel">
          <div className="panel-header">MEMORY.md PREVIEW</div>
          <div className="p-3 max-h-[300px] overflow-auto">
            <pre className="text-[10px] text-foreground whitespace-pre-wrap leading-relaxed font-mono">{data.memorySummary}</pre>
          </div>
        </div>
      )}

      {/* HEARTBEAT.md */}
      {data?.heartbeat && (
        <div className="panel">
          <div className="panel-header">HEARTBEAT.md</div>
          <div className="p-3 max-h-[200px] overflow-auto">
            <pre className="text-[10px] text-foreground whitespace-pre-wrap leading-relaxed font-mono">{data.heartbeat}</pre>
          </div>
        </div>
      )}

      {/* Daily Memory Files */}
      <div className="panel">
        <div className="panel-header">DAILY MEMORY FILES</div>
        <div className="p-3 space-y-0.5">
          {(data?.dailyFiles || []).length === 0 ? (
            <EmptyState icon={Brain} message="No daily memory files found" />
          ) : (
            data?.dailyFiles.map(f => (
              <div key={f}>
                <div onClick={() => loadDailyFile(f)} className="flex items-center gap-2 data-cell cursor-pointer hover:bg-[rgba(0,240,255,0.03)]">
                  {expandedFile === f ? <ChevronDown className="h-3 w-3 text-[var(--neon-cyan)] shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                  <span className="text-[11px] font-bold text-foreground">{f.replace(".md", "")}</span>
                </div>
                {expandedFile === f && (
                  <div className="ml-5 p-2 border-l-2 border-[rgba(0,240,255,0.15)] mb-2">
                    {fileContent[f] ? (
                      <pre className="text-[10px] text-foreground whitespace-pre-wrap leading-relaxed font-mono max-h-[300px] overflow-auto">{fileContent[f]}</pre>
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
