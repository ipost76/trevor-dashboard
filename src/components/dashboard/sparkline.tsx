"use client";
import * as React from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  YAxis,
  Tooltip,
} from "recharts";

interface SparklinePoint {
  ts: string;
  equity: number;
  pnl: number;
}

interface SparklineProps {
  data: ReadonlyArray<SparklinePoint>;
  color: string;
  height?: number;
}

export function Sparkline({ data, color, height = 64 }: SparklineProps) {
  const id = React.useId();
  if (data.length < 2) {
    return (
      <div
        style={{ height }}
        className="text-micro text-fg-faint flex items-center justify-center"
      >
        — no series —
      </div>
    );
  }
  return (
    <div style={{ height }} className="-mx-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={[...data]}
          margin={{ left: 0, right: 0, top: 4, bottom: 0 }}
        >
          <defs>
            <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.5} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip
            contentStyle={{
              background: "#12121a",
              border: "1px solid rgba(0,240,255,0.3)",
              fontSize: 11,
            }}
            labelStyle={{ color: "#8a8a98" }}
            formatter={(v: number) => [v.toFixed(2), "Equity"]}
          />
          <Area
            type="monotone"
            dataKey="equity"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#grad-${id})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
