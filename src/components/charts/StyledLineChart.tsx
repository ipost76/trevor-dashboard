"use client";
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
};

export function StyledLineChart({
  data, lines, xKey = "date", height = 200, showArea = false, referenceLine,
}: Props) {
  if (!data?.length) return null;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
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
            stroke={l.color || CHART_COLORS.green}
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
            fill={l.color || CHART_COLORS.green}
            fillOpacity={0.1}
            stroke="none"
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
