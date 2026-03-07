"use client";

import { useEffect, useState, useCallback } from "react";
import { Shield, CheckCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";

type SecurityEvent = {
  id: number; event_type: string; severity: string;
  description: string; file_path?: string; created_at: string;
};

export default function SecurityPage() {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const fetchData = useCallback(async () => {
    setLoading(true);
    const offset = (page - 1) * pageSize;
    const d = await safeFetch<{ events?: SecurityEvent[]; total?: number }>(
      `/api/security?limit=${pageSize}&offset=${offset}`, {}
    );
    setEvents(d.events || []);
    setTotal(d.total || 0);
    setLoading(false);
  }, [page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const severityColor: Record<string, string> = {
    critical: "neon-red", high: "neon-red", HIGH: "neon-red",
    medium: "neon-amber", MEDIUM: "neon-amber",
    low: "text-muted-foreground", LOW: "text-muted-foreground",
    info: "text-[var(--neon-cyan)]", INFO: "text-[var(--neon-cyan)]",
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="flex-1 overflow-auto p-2">
      <div className="panel h-full flex flex-col">
        <div className="panel-header flex items-center gap-2">
          <Shield className="h-3 w-3" />
          <span>SECURITY EVENTS</span>
          <span className="ml-auto text-muted-foreground font-normal">{total} events</span>
        </div>

        {loading ? (
          <div className="flex-1 p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-7 rounded bg-[rgba(0,240,255,0.03)] animate-pulse" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground gap-2">
            <CheckCircle className="h-8 w-8 opacity-20 text-[var(--neon-green)]" />
            <span className="text-[11px]">No security events recorded</span>
            <span className="text-[9px] opacity-50">Security scans run automatically</span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--border)] text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground bg-[var(--panel-header)]">
              <span className="w-14">Severity</span>
              <span className="w-24">Type</span>
              <span className="flex-1">Description</span>
              <span className="w-48 hidden md:block">File</span>
              <span className="w-28 text-right">Time</span>
            </div>
            <div className="flex-1 overflow-auto">
              {events.map((e, i) => (
                <div key={e.id} className={cn(
                  "flex items-center gap-2 data-cell hover:bg-[rgba(0,240,255,0.03)]",
                  i % 2 === 0 ? "bg-[#0e0f18]" : "bg-[#12131a]"
                )}>
                  <span className={cn("w-14 text-[10px] font-bold uppercase", severityColor[e.severity] || "text-muted-foreground")}>{e.severity}</span>
                  <span className="w-24 text-[10px] truncate badge-regime">{e.event_type}</span>
                  <span className="flex-1 text-[10px] text-muted-foreground truncate">{e.description}</span>
                  <span className="w-48 text-[9px] text-muted-foreground truncate hidden md:block">{e.file_path?.split("/").pop() || ""}</span>
                  <span className="w-28 text-right text-[9px] text-muted-foreground">
                    {e.created_at ? new Date(e.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : ""}
                  </span>
                </div>
              ))}
            </div>
            {total > pageSize && (
              <div className="flex items-center justify-center gap-3 py-2 border-t border-[var(--border)]">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="btn-primary disabled:opacity-30">
                  <ChevronLeft className="h-3 w-3" />
                </button>
                <span className="text-[10px] text-muted-foreground">
                  Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} of {total}
                </span>
                <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages} className="btn-primary disabled:opacity-30">
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
