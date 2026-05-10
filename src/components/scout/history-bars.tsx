"use client";

import { useMemo } from "react";
import type { HistoryRow } from "./types";

/**
 * Tiny CSS-bar chart of "signals per day" over a rolling window. Avoids
 * pulling in recharts for a strip this small. The hover-tooltip is a
 * group-positioned span over each bar.
 */
export function HistoryBars({
  rows,
  loading,
  windowDays = 30,
}: {
  rows: HistoryRow[];
  loading?: boolean;
  windowDays?: number;
}) {
  const buckets = useMemo(() => {
    if (!rows?.length) return [];
    const byDate = new Map<string, number>();
    for (const r of rows) {
      const d = (r.run_date ?? "").slice(0, 10);
      if (!d) continue;
      byDate.set(d, (byDate.get(d) ?? 0) + 1);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-windowDays)
      .map(([date, count]) => ({ date, count }));
  }, [rows, windowDays]);

  if (loading) {
    return <div className="h-14 animate-shimmer-ds rounded-md bg-gradient-to-r from-bg-elevated via-bg-card to-bg-elevated bg-[length:200%_100%]" />;
  }

  if (!buckets.length) {
    return (
      <div className="flex h-14 items-center text-micro text-fg-muted">
        no history yet
      </div>
    );
  }

  const max = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <div
      className="flex h-14 items-end gap-1"
      role="img"
      aria-label={`${windowDays}-day signal count`}
    >
      {buckets.map((b) => (
        <div
          key={b.date}
          className="group relative flex-1 rounded-t-sm bg-accent-cyan/30 transition-colors duration-fast hover:bg-accent-cyan"
          style={{ height: `${Math.max(8, (b.count / max) * 100)}%` }}
          title={`${b.date}: ${b.count}`}
        >
          <span className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-bg-card px-1 py-0.5 text-[9px] text-fg-muted opacity-0 group-hover:opacity-100">
            {b.count}
          </span>
        </div>
      ))}
    </div>
  );
}
