"use client";
import { useEffect, useState, useCallback } from "react";
import { Activity, CheckCircle, XCircle, Clock, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";

type Signal = {
  id: number; ticker: string; signal_type: string; confidence: number;
  outcome: string | null; created_at: string; direction?: string;
  timeframe?: string; entry_price?: number; target_price?: number; stop_price?: number;
};

export default function SignalsPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 50;

  const fetchSignals = useCallback(async () => {
    setLoading(true);
    const offset = (page - 1) * pageSize;
    const d = await safeFetch<{ records?: Signal[]; total?: number }>(
      `/api/signals?limit=${pageSize}&offset=${offset}`, {}
    );
    setSignals(d.records || []);
    setTotal(d.total || 0);
    setLoading(false);
  }, [page]);

  useEffect(() => { fetchSignals(); }, [fetchSignals]);

  // Auto-refresh every 60s
  useEffect(() => {
    const i = setInterval(fetchSignals, 60000);
    return () => clearInterval(i);
  }, [fetchSignals]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="flex-1 overflow-auto p-2">
      <div className="panel h-full flex flex-col">
        <div className="panel-header flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-3 w-3" />
            <span>SIGNAL FEED</span>
          </div>
          <span className="text-muted-foreground font-normal">{total} signals</span>
        </div>

        {/* Table Header */}
        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--border)] text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground bg-[var(--panel-header)]">
          <span className="w-20">Ticker</span>
          <span className="w-12">Dir</span>
          <span className="flex-1">Signal</span>
          <span className="w-14 text-right">Conf</span>
          <span className="w-16 text-right hidden md:block">Entry</span>
          <span className="w-16 text-right hidden md:block">Target</span>
          <span className="w-16 text-right hidden md:block">Stop</span>
          <span className="w-10 text-center">Result</span>
          <span className="w-24 text-right hidden sm:block">Time</span>
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="space-y-2 w-full px-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-7 rounded bg-[rgba(0,240,255,0.03)] animate-pulse" />
                ))}
              </div>
            </div>
          ) : signals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <Activity className="h-6 w-6 opacity-20" />
              <span className="text-[11px]">No signals generated yet</span>
              <span className="text-[9px] opacity-50">Signals appear here when TREVOR detects setups</span>
            </div>
          ) : (
            signals.map((s, i) => {
              const isLong = s.direction?.toLowerCase() === "long" || s.direction?.toLowerCase() === "buy";
              const time = s.created_at ? new Date(s.created_at).toLocaleString("en-US", {
                month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false
              }) : "";
              return (
                <div key={s.id || i} className={cn(
                  "flex items-center gap-2 data-cell hover:bg-[rgba(0,240,255,0.03)] transition-colors",
                  i % 2 === 0 ? "bg-[#0e0f18]" : "bg-[#12131a]"
                )}>
                  <span className="w-20 font-bold text-foreground truncate">{s.ticker}</span>
                  <span className="w-12">
                    <span className={isLong ? "badge-long" : "badge-short"}>{isLong ? "LONG" : "SHORT"}</span>
                  </span>
                  <span className="flex-1 text-muted-foreground truncate text-[10px]">{s.signal_type}</span>
                  <span className="w-14 text-right">
                    <span className={cn("font-bold", s.confidence >= 70 ? "neon-green" : s.confidence >= 50 ? "neon-amber" : "neon-red")}>
                      {s.confidence}%
                    </span>
                  </span>
                  <span className="w-16 text-right text-muted-foreground hidden md:block">
                    {s.entry_price ? `$${s.entry_price.toFixed(2)}` : "-"}
                  </span>
                  <span className="w-16 text-right text-[var(--neon-green)] opacity-70 hidden md:block">
                    {s.target_price ? `$${s.target_price.toFixed(2)}` : "-"}
                  </span>
                  <span className="w-16 text-right text-[var(--neon-red)] opacity-70 hidden md:block">
                    {s.stop_price ? `$${s.stop_price.toFixed(2)}` : "-"}
                  </span>
                  <span className="w-10 flex justify-center">
                    {s.outcome?.toLowerCase() === "win" && <CheckCircle className="h-3.5 w-3.5 text-[var(--neon-green)]" />}
                    {s.outcome?.toLowerCase() === "loss" && <XCircle className="h-3.5 w-3.5 text-[var(--neon-red)]" />}
                    {(!s.outcome || !["win", "loss"].includes(s.outcome.toLowerCase())) && <Clock className="h-3.5 w-3.5 text-muted-foreground" />}
                  </span>
                  <span className="w-24 text-right text-[10px] text-muted-foreground hidden sm:block">{time}</span>
                </div>
              );
            })
          )}
        </div>

        {/* Pagination */}
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
      </div>
    </div>
  );
}
