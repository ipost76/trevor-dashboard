"use client";
import { useEffect, useState } from "react";
import { CheckCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { EmptyState } from "@/components/ui/empty-state";

type SecurityEvent = {
  id: number; event_type: string; severity: string;
  description: string; file_path?: string; created_at: string;
};

const severityColor: Record<string, string> = {
  critical: "neon-red", high: "neon-red", medium: "neon-amber",
  low: "text-muted-foreground", info: "text-[var(--neon-cyan)]",
};

export function SecurityViewer() {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    safeFetch<{ securityEvents?: SecurityEvent[] }>("/api/live", {}).then(d => {
      setEvents(d.securityEvents || []);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-5 w-5 animate-spin text-[var(--neon-cyan)]" />
      </div>
    );
  }

  if (events.length === 0) {
    return <EmptyState icon={CheckCircle} message="No security events recorded" className="py-12" />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--border)] text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground bg-[var(--panel-header)]">
        <span className="w-14">Severity</span>
        <span className="w-24">Type</span>
        <span className="flex-1">Description</span>
        <span className="w-20 text-right">Time</span>
      </div>
      <div className="flex-1 overflow-auto">
        {events.map(e => (
          <div key={e.id} className="flex items-center gap-2 data-cell hover:bg-[rgba(0,240,255,0.03)]">
            <span className={cn("w-14 text-[10px] font-bold uppercase", severityColor[e.severity?.toLowerCase()] || "text-muted-foreground")}>{e.severity}</span>
            <span className="w-24 text-[10px] truncate badge-regime">{e.event_type}</span>
            <span className="flex-1 text-[10px] text-muted-foreground truncate">{e.description}</span>
            <span className="w-20 text-right text-[9px] text-muted-foreground">
              {e.created_at ? new Date(e.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
