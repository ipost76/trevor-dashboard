"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Brain, Trophy, FileText, Database, DollarSign,
  RefreshCw, ChevronDown, ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";

type Tab = "xp" | "brain" | "vectors" | "costs";

const RANKS = [
  { name: "Intern Quant", xp: 0 }, { name: "Junior Analyst", xp: 50 }, { name: "Analyst", xp: 120 },
  { name: "Senior Analyst", xp: 250 }, { name: "Associate", xp: 500 }, { name: "VP", xp: 800 },
  { name: "Senior VP", xp: 1200 }, { name: "Director", xp: 1800 }, { name: "Managing Director", xp: 2500 },
  { name: "Partner", xp: 3500 }, { name: "Senior Partner", xp: 5000 }, { name: "Chief Strategist", xp: 7000 },
  { name: "Head of Trading", xp: 10000 }, { name: "CIO", xp: 15000 }, { name: "CEO", xp: 25000 },
];

export default function BrainPage() {
  const [tab, setTab] = useState<Tab>("xp");
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    const d = await safeFetch<Record<string, unknown>>(`/api/brain?scope=${tab}`, {});
    setData(Object.keys(d).length > 0 ? d : null);
    setLoading(false);
  }, [tab]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const tabs = [
    { key: "xp" as Tab, label: "XP", icon: Trophy },
    { key: "brain" as Tab, label: "BRAIN FILES", icon: FileText },
    { key: "vectors" as Tab, label: "VECTORS", icon: Database },
    { key: "costs" as Tab, label: "COSTS", icon: DollarSign },
  ];

  const toggleFile = (name: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

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
          <div className="flex-1 overflow-auto p-3">
            {/* XP Tab */}
            {tab === "xp" && data && (
              <div className="space-y-4">
                <div className="flex items-center gap-4 mb-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded bg-[rgba(0,240,255,0.08)] border border-[rgba(0,240,255,0.2)]">
                    <Trophy className="h-8 w-8 text-[var(--neon-cyan)]" />
                  </div>
                  <div>
                    <div className="stat-value neon-text">{String((data as Record<string, unknown>).currentXP ?? 0)} XP</div>
                    <div className="text-[11px] text-muted-foreground mt-1">{String((data as Record<string, unknown>).currentRank ?? "Unknown")}</div>
                  </div>
                </div>
                <div className="space-y-1">
                  {RANKS.map((r, i) => {
                    const currentXP = Number((data as Record<string, unknown>).currentXP ?? 0);
                    const nextRank = RANKS[i + 1];
                    const isCurrentRank = currentXP >= r.xp && (!nextRank || currentXP < nextRank.xp);
                    const isPast = currentXP >= r.xp && !isCurrentRank;
                    const progress = isCurrentRank && nextRank ? ((currentXP - r.xp) / (nextRank.xp - r.xp)) * 100 : isPast ? 100 : 0;
                    return (
                      <div key={r.name} className={cn(
                        "flex items-center gap-2 px-2 py-1 rounded text-[10px]",
                        isCurrentRank ? "bg-[rgba(0,240,255,0.06)] border border-[rgba(0,240,255,0.15)]" : ""
                      )}>
                        <span className={cn("w-32 truncate", isCurrentRank ? "neon-text font-bold" : isPast ? "text-foreground" : "text-muted-foreground")}>{r.name}</span>
                        <span className="w-12 text-right font-mono text-muted-foreground">{r.xp}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-[rgba(255,255,255,0.04)]">
                          <div className={cn("h-full rounded-full transition-all", isCurrentRank ? "bg-[var(--neon-cyan)]" : isPast ? "bg-[var(--neon-green)] opacity-50" : "")} style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Brain Files Tab */}
            {tab === "brain" && data && (
              <div className="space-y-1">
                {Object.entries((data as Record<string, Record<string, string>>).files || {}).map(([name, content]) => (
                  <div key={name} className="panel">
                    <button
                      onClick={() => toggleFile(name)}
                      className="flex items-center gap-2 w-full px-3 py-2 text-[11px] font-bold hover:bg-[rgba(0,240,255,0.03)]"
                    >
                      {expandedFiles.has(name) ? <ChevronDown className="h-3 w-3 text-[var(--neon-cyan)]" /> : <ChevronRight className="h-3 w-3" />}
                      <FileText className="h-3 w-3 text-muted-foreground" />
                      <span>{name}</span>
                    </button>
                    {expandedFiles.has(name) && (
                      <pre className="px-3 pb-3 text-[10px] text-muted-foreground whitespace-pre-wrap font-mono overflow-auto max-h-64">{String(content)}</pre>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Vectors Tab */}
            {tab === "vectors" && data && (
              <div className="space-y-2">
                {((data as Record<string, unknown[]>).collections || []).length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-[11px]">No vector collections found</div>
                ) : (
                  ((data as Record<string, Array<{ name: string; count: number }>>).collections || []).map(c => (
                    <div key={c.name} className="panel p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Database className="h-3.5 w-3.5 text-[var(--neon-magenta)]" />
                        <span className="text-[11px] font-bold">{c.name}</span>
                      </div>
                      <span className="text-[11px] font-mono neon-text">{c.count} vectors</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Costs Tab */}
            {tab === "costs" && data && (
              <div className="space-y-3">
                <div className="flex items-center gap-4 mb-4">
                  <StatBlock label="Total Spend" value={`$${Number((data as Record<string, unknown>).totalSpend ?? 0).toFixed(3)}`} />
                  <StatBlock label="Budget" value="$0.250 / day" />
                </div>
                <div className="panel-header">DAILY COSTS</div>
                <div className="space-y-0">
                  {((data as Record<string, Array<{ date: string; cost: number }>>).daily || []).slice(-14).map(d => (
                    <div key={d.date} className="flex items-center gap-2 data-cell">
                      <span className="w-20 text-muted-foreground">{d.date}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-[rgba(255,255,255,0.04)]">
                        <div className="h-full rounded-full bg-[var(--neon-cyan)]" style={{ width: `${Math.min(100, (d.cost / 0.25) * 100)}%` }} />
                      </div>
                      <span className="w-16 text-right font-mono text-[11px]">${d.cost.toFixed(4)}</span>
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

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="stat-value neon-text">{value}</div>
    </div>
  );
}
