"use client";

import { useMemo } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { Position } from "@/app/holdings/page";

type AllocationChartProps = {
  positions: Position[];
};

const ASSET_COLORS: Record<string, string> = {
  stock: "#00f0ff",
  etf: "#ffaa00",
  crypto_spot: "#00ff88",
  crypto_perp: "#ff00ff",
  auto: "#6b6b80",
};

const ASSET_LABELS: Record<string, string> = {
  stock: "Stock",
  etf: "ETF",
  crypto_spot: "Crypto Spot",
  crypto_perp: "Crypto Perp",
  auto: "Auto",
};

type ChartEntry = {
  name: string;
  value: number;
  color: string;
  pct: number;
};

export function AllocationChart({ positions }: AllocationChartProps) {
  const data = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of positions) {
      const key = p.asset_type || "auto";
      counts[key] = (counts[key] || 0) + 1;
    }

    const total = positions.length;
    const entries: ChartEntry[] = Object.entries(counts)
      .map(([type, count]) => ({
        name: ASSET_LABELS[type] || type,
        value: count,
        color: ASSET_COLORS[type] || "#6b6b80",
        pct: total > 0 ? (count / total) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);

    return { entries, total };
  }, [positions]);

  if (data.entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[11px] text-muted-foreground">
        No positions to display
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 h-full min-h-[140px]">
      {/* Chart */}
      <div className="relative w-[140px] h-[140px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data.entries}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={38}
              outerRadius={62}
              paddingAngle={2}
              strokeWidth={0}
            >
              {data.entries.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.color}
                  fillOpacity={0.75}
                  style={{ filter: `drop-shadow(0 0 4px ${entry.color}40)` }}
                />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as ChartEntry;
                return (
                  <div className="panel px-2 py-1 text-[10px] font-mono">
                    <span style={{ color: d.color }} className="font-bold">
                      {d.name}
                    </span>
                    : {d.value} ({d.pct.toFixed(0)}%)
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-lg font-bold neon-text">{data.total}</span>
          <span className="text-[8px] text-muted-foreground uppercase tracking-wider">
            Positions
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
        {data.entries.map((entry) => (
          <div key={entry.name} className="flex items-center gap-2">
            <div
              className="w-2.5 h-2.5 rounded-sm shrink-0"
              style={{
                backgroundColor: entry.color,
                boxShadow: `0 0 6px ${entry.color}40`,
              }}
            />
            <span className="text-[10px] text-foreground truncate flex-1">
              {entry.name}
            </span>
            <span className="text-[10px] font-mono font-bold text-muted-foreground shrink-0">
              {entry.value}
            </span>
            <span className="text-[9px] font-mono text-muted-foreground shrink-0 w-10 text-right">
              {entry.pct.toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
