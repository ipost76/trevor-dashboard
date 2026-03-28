"use client";
import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Area } from "recharts";
import { CHART_COLORS } from "./theme";

type LineConfig = { dataKey: string; color?: string; name?: string };

type Props = {
  data: Array<Record<string, unknown>>;
  lines: LineConfig[];
  xKey?: string;
  height?: number;
  showArea?: boolean;
  referenceLine?: number;
  splitColorAtZero?: boolean;
};

export function StyledLineChart({
  data, lines, xKey = "date", height = 200, showArea = false, referenceLine,
  splitColorAtZero = false,
}: Props) {
  if (!data?.length) return null;

  const gradientOffset = useMemo(() => {
    if (!splitColorAtZero || !lines[0]) return 1;
    const key = lines[0].dataKey;
    const vals = data.map((d) => Number(d[key]) || 0);
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    if (max <= 0) return 0;
    if (min >= 0) return 1;
    return max / (max - min);
  }, [data, lines, splitColorAtZero]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
        {splitColorAtZero && (
          <defs>
            <linearGradient id="splitStroke" x1="0" y1="0" x2="0" y2="1">
              <stop offset={gradientOffset} stopColor="#00ff88" stopOpacity={1} />
              <stop offset={gradientOffset} stopColor="#ff4444" stopOpacity={1} />
            </linearGradient>
            <linearGradient id="splitFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset={gradientOffset} stopColor="#00ff88" stopOpacity={0.2} />
              <stop offset={gradientOffset} stopColor="#ff4444" stopOpacity={0.2} />
            </linearGradient>
          </defs>
        )}
        <XAxis dataKey={xKey} tick={{ fill: CHART_COLORS.textMuted, fontSize: 10 }} />
        <YAxis tick={{ fill: CHART_COLORS.textMuted, fontSize: 10 }} width={45} />
        <Tooltip
          contentStyle={{ background: CHART_COLORS.tooltip, border: `1px solid ${CHART_COLORS.border}`, fontSize: 11, fontFamily: "monospace" }}
          labelStyle={{ color: CHART_COLORS.text }}
        />
        {referenceLine !== undefined && (
          <ReferenceLine y={referenceLine} stroke={CHART_COLORS.textMuted} strokeDasharray="3 3" />
        )}
        {lines.map((l) => (
          <Line
            key={l.dataKey}
            type="monotone"
            dataKey={l.dataKey}
            stroke={splitColorAtZero ? "url(#splitStroke)" : (l.color || CHART_COLORS.green)}
            strokeWidth={2}
            dot={false}
            name={l.name || l.dataKey}
          />
        ))}
        {showArea && lines.map((l) => (
          <Area
            key={`area-${l.dataKey}`}
            type="monotone"
            dataKey={l.dataKey}
            fill={splitColorAtZero ? "url(#splitFill)" : (l.color || CHART_COLORS.green)}
            fillOpacity={splitColorAtZero ? 1 : 0.1}
            stroke="none"
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
