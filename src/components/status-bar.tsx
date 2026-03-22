"use client";
import { useEffect, useState } from "react";
import { safeFetch } from "@/lib/fetch";

export function StatusBar() {
  const [stats, setStats] = useState<{
    dbSize?: string;
    trades?: number;
    signals?: number;
    uptime?: string;
    cost?: string;
    rank?: string;
  }>({});

  useEffect(() => {
    const fetchStats = async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = await safeFetch<any>("/api/status", {});
      if (d && Object.keys(d).length > 0) {
        const sigObj = typeof d.signals === "object" && d.signals ? d.signals : null;
        setStats({
          trades: sigObj?.total ?? (typeof d.trades === "number" ? d.trades : 0),
          signals: sigObj?.total ?? (typeof d.signals === "number" ? d.signals : 0),
          cost: typeof d.todayCost === "number"
            ? `$${d.todayCost.toFixed(3)}`
            : typeof d.cost_today === "number"
              ? `$${d.cost_today.toFixed(3)}`
              : "$0.000",
          uptime: d.trevor?.running ? "ONLINE" : "OFFLINE",
          rank: d.rank || "Unknown",
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
        <span>TREVOR V3</span>
        <span className={stats.uptime === "ONLINE" ? "text-[var(--neon-green)] opacity-80" : "text-[var(--neon-red)] opacity-80"}>
          {stats.uptime || "..."}
        </span>
        {stats.trades !== undefined && <span>SIGNALS: {stats.signals}</span>}
        {stats.rank && <span>RANK: {stats.rank}</span>}
      </div>
      <div className="flex items-center gap-4">
        <span>COST TODAY: {stats.cost || "..."}</span>
        <span>HUB v5</span>
      </div>
    </div>
  );
}
