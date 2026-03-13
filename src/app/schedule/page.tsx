"use client";
import { useEffect, useState, useCallback } from "react";
import { RefreshCw, CheckCircle, XCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";

type Job = {
  name: string;
  enabled: boolean;
  schedule: string;
  description: string;
  handler: string;
  nextRun: string;
};

const JOB_COLORS: Record<string, string> = {
  morning_briefing: "var(--neon-green)",
  eod_review: "var(--neon-amber)",
  daily_memory: "var(--neon-cyan)",
  weekly_distillation: "#8855ff",
  heartbeat_update: "var(--neon-magenta)",
};

// Approximate hour (ET) for timeline positioning
const JOB_HOURS: Record<string, number> = {
  morning_briefing: 9.42,   // 9:25am
  eod_review: 16.25,        // 4:15pm
  daily_memory: 16.5,       // 4:30pm
  weekly_distillation: 2,   // 2:00am
  heartbeat_update: -1,     // recurring (shown differently)
};

export default function SchedulePage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const raw = await safeFetch<{ jobs: Job[] } | null>("/api/schedule", null);
    if (raw?.jobs) setJobs(raw.jobs);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <RefreshCw className="h-5 w-5 animate-spin text-[var(--neon-cyan)]" />
      </div>
    );
  }

  const enabledCount = jobs.filter(j => j.enabled).length;
  const timelineJobs = jobs.filter(j => JOB_HOURS[j.name] != null && JOB_HOURS[j.name] >= 0);

  return (
    <div className="flex-1 overflow-auto p-3">
      <div className="panel-header mb-3">ORCHESTRATOR SCHEDULE</div>

      {/* Summary */}
      <div className="flex gap-3 mb-4">
        <div className="panel px-3 py-2 flex items-center gap-2">
          <CheckCircle className="h-3.5 w-3.5 text-[var(--neon-green)]" />
          <span className="text-[10px] text-muted-foreground">ENABLED:</span>
          <span className="text-[12px] font-bold neon-green">{enabledCount}</span>
          <span className="text-[10px] text-muted-foreground">/ {jobs.length}</span>
        </div>
      </div>

      {/* 24h Timeline */}
      <div className="panel mb-4">
        <div className="panel-header">24-HOUR TIMELINE (ET)</div>
        <div className="p-3">
          <div className="relative h-10 rounded bg-[var(--muted)]" style={{ border: "1px solid var(--border)" }}>
            {/* Hour markers */}
            {[0, 4, 8, 12, 16, 20].map(h => (
              <div key={h} className="absolute top-0 bottom-0" style={{ left: `${(h / 24) * 100}%` }}>
                <div className="h-full border-l border-[rgba(0,240,255,0.1)]" />
                <div className="absolute -bottom-4 text-[8px] text-muted-foreground" style={{ transform: "translateX(-50%)" }}>
                  {h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`}
                </div>
              </div>
            ))}
            {/* Job dots */}
            {timelineJobs.map(j => {
              const hour = JOB_HOURS[j.name] || 0;
              const left = (hour / 24) * 100;
              const color = JOB_COLORS[j.name] || "var(--neon-cyan)";
              return (
                <div
                  key={j.name}
                  className="absolute top-1/2 -translate-y-1/2"
                  style={{ left: `${left}%` }}
                  title={`${j.name}: ${j.description}`}
                >
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
                  />
                </div>
              );
            })}
          </div>
          {/* Legend */}
          <div className="flex flex-wrap gap-3 mt-6">
            {timelineJobs.map(j => (
              <div key={j.name} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: JOB_COLORS[j.name] || "var(--neon-cyan)" }} />
                <span className="text-[9px] text-muted-foreground">{j.name.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Job Cards */}
      <div className="space-y-2 stagger-cards">
        {jobs.map(j => {
          const color = JOB_COLORS[j.name] || "var(--neon-cyan)";
          return (
            <div key={j.name} className="panel" style={{ borderLeftColor: color, borderLeftWidth: 3 }}>
              <div className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-bold text-foreground">{j.name.replace(/_/g, " ").toUpperCase()}</span>
                    {j.enabled ? (
                      <span className="flex items-center gap-1 text-[9px] neon-green">
                        <CheckCircle className="h-2.5 w-2.5" /> ENABLED
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[9px] neon-red">
                        <XCircle className="h-2.5 w-2.5" /> DISABLED
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span className="font-bold" style={{ color }}>{j.nextRun}</span>
                  </div>
                </div>
                <div className="text-[10px] text-muted-foreground mb-1">{j.description}</div>
                <div className="flex items-center gap-3 text-[9px] text-muted-foreground">
                  <span>Schedule: <span className="text-foreground">{j.schedule}</span></span>
                  <span>Handler: <span className="text-foreground">{j.handler}</span></span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
