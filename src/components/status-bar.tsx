"use client";
import { useEffect, useState } from "react";
import { safeFetch } from "@/lib/fetch";

export function StatusBar() {
  const [stats, setStats] = useState<{
    dbSize?: string; trades?: number; signals?: number;
    uptime?: string; cost?: string; training?: string;
  }>({});

  useEffect(() => {
    const fetchStats = async () => {
      const d = await safeFetch<Record<string, unknown>>("/api/status", {});
      if (d && Object.keys(d).length > 0) {
        const sigObj = typeof d.signals === "object" && d.signals ? (d.signals as Record<string, number>) : null;
        setStats({
          trades: sigObj?.total ?? (typeof d.signals === "number" ? d.signals : 0),
          signals: sigObj?.total ?? 0,
          cost: typeof d.costToday === "number" ? `$${(d.costToday as number).toFixed(3)}` : "$0.000",
          uptime: (d.trevor as Record<string, unknown>)?.running ? "ONLINE" : "OFFLINE",
        });
      }
    };
    fetchStats();
    const i = setInterval(fetchStats, 60000);
    return () => clearInterval(i);
  }, []);

  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--panel-header)] px-3 text-[9px] font-mono text-muted-foreground">
      <div className="flex items-center gap-4">
        <span>TREVOR v3.1</span>
        <span className={stats.uptime === "ONLINE" ? "text-[var(--neon-green)] opacity-60" : "text-[var(--neon-red)] opacity-60"}>
          {stats.uptime || "..."}
        </span>
        {stats.signals !== undefined && <span>SIGNALS: {stats.signals}</span>}
      </div>
      <div className="flex items-center gap-4 hidden sm:flex">
        <span>COST TODAY: {stats.cost || "..."}</span>
        <span>1.9M TRAINING ROWS</span>
      </div>
    </div>
  );
}
