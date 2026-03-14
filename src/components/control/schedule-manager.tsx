"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Calendar, CheckCircle, XCircle, Clock, Play, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { EmptyState } from "@/components/ui/empty-state";

type Job = {
  name: string;
  enabled: boolean;
  schedule: string;
  description: string;
  handler: string;
  nextRun: string;
};

export function ScheduleManager() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { type: "ok" | "err"; text: string }>>({});

  const fetchJobs = useCallback(async () => {
    const raw = await safeFetch<{ jobs: Job[] } | null>("/api/schedule", null);
    if (raw?.jobs) setJobs(raw.jobs);
    setLoading(false);
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const handleToggle = async (jobName: string, currentEnabled: boolean) => {
    setToggling(jobName);
    setMessages((prev) => ({ ...prev, [jobName]: undefined as unknown as { type: "ok" | "err"; text: string } }));
    try {
      const res = await fetch("/api/schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_name: jobName, enabled: !currentEnabled }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setMessages((prev) => ({ ...prev, [jobName]: { type: "err", text: data.error || "Toggle failed" } }));
      } else {
        setJobs((prev) => prev.map((j) => (j.name === jobName ? { ...j, enabled: !currentEnabled } : j)));
        setMessages((prev) => ({ ...prev, [jobName]: { type: "ok", text: !currentEnabled ? "Enabled" : "Disabled" } }));
      }
    } catch (err) {
      setMessages((prev) => ({ ...prev, [jobName]: { type: "err", text: String(err) } }));
    }
    setToggling(null);
  };

  const handleRunNow = async (jobName: string) => {
    setTriggering(jobName);
    setMessages((prev) => ({ ...prev, [jobName]: undefined as unknown as { type: "ok" | "err"; text: string } }));
    try {
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_name: jobName }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setMessages((prev) => ({ ...prev, [jobName]: { type: "err", text: data.error || "Trigger failed" } }));
      } else {
        setMessages((prev) => ({ ...prev, [jobName]: { type: "ok", text: "Triggered successfully" } }));
      }
    } catch (err) {
      setMessages((prev) => ({ ...prev, [jobName]: { type: "err", text: String(err) } }));
    }
    setTriggering(null);
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <RefreshCw className="h-5 w-5 animate-spin text-[var(--neon-cyan)]" />
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <EmptyState icon={Calendar} message="No scheduled jobs found" sub="Schedule configuration may not be available" />
    );
  }

  const enabledCount = jobs.filter((j) => j.enabled).length;

  return (
    <div className="p-3 overflow-auto">
      {/* Summary */}
      <div className="flex gap-3 mb-4">
        <div className="panel px-3 py-2 flex items-center gap-2">
          <CheckCircle className="h-3.5 w-3.5 text-[var(--neon-green)]" />
          <span className="text-[10px] text-muted-foreground">ENABLED:</span>
          <span className="text-[12px] font-bold neon-green">{enabledCount}</span>
          <span className="text-[10px] text-muted-foreground">/ {jobs.length}</span>
        </div>
      </div>

      {/* Job Cards */}
      <div className="space-y-2">
        {jobs.map((j) => {
          const msg = messages[j.name];
          return (
            <div key={j.name} className="panel">
              <div className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-3">
                    <span className="text-[12px] font-bold text-foreground">
                      {j.name.replace(/_/g, " ").toUpperCase()}
                    </span>

                    {/* Toggle switch */}
                    <button
                      onClick={() => handleToggle(j.name, j.enabled)}
                      disabled={toggling === j.name}
                      className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none"
                      style={{
                        backgroundColor: j.enabled ? "var(--neon-green)" : "rgba(255,255,255,0.1)",
                      }}
                      aria-label={j.enabled ? "Disable job" : "Enable job"}
                    >
                      <span
                        className={cn(
                          "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-200 shadow-sm",
                          j.enabled ? "translate-x-[18px]" : "translate-x-[3px]"
                        )}
                      />
                    </button>

                    <span className={cn(
                      "text-[9px] font-bold",
                      j.enabled ? "neon-green" : "neon-red"
                    )}>
                      {j.enabled ? "ON" : "OFF"}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {msg && (
                      <span className={cn("text-[9px] font-bold", msg.type === "ok" ? "neon-green" : "neon-red")}>
                        {msg.text}
                      </span>
                    )}
                    <button
                      onClick={() => handleRunNow(j.name)}
                      disabled={triggering === j.name}
                      className="btn-primary flex items-center gap-1 text-[9px]"
                    >
                      {triggering === j.name ? (
                        <RefreshCw className="h-3 w-3 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                      RUN NOW
                    </button>
                  </div>
                </div>

                <div className="text-[10px] text-muted-foreground mb-1">{j.description}</div>

                <div className="flex items-center gap-4 text-[9px] text-muted-foreground">
                  <span>
                    Schedule: <span className="text-foreground">{j.schedule}</span>
                  </span>
                  <span>
                    Handler: <span className="text-foreground">{j.handler}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" />
                    Next: <span className="text-[var(--neon-cyan)] font-bold">{j.nextRun}</span>
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
