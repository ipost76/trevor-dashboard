"use client";
import { useEffect, useState } from "react";
import { safeFetch } from "@/lib/fetch";
import { fmtPrice } from "@/lib/format";

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
            ? `$${fmtPrice(d.todayCost)}`
            : typeof d.cost_today === "number"
              ? `$${fmtPrice(d.cost_today)}`
              : "$0",
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
    <div className="hidden md:flex h-6 shrink-0 items-center justify-between border-t border-border-subtle bg-[var(--panel-header)] px-3 text-[9px] font-mono text-fg-muted">
      <div className="flex items-center gap-4">
        <span>TREVOR V3</span>
        <span className={stats.uptime === "ONLINE" ? "text-accent-mint-strong opacity-90" : "text-accent-red opacity-90"}>
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
