"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { CHART_COLORS } from "./theme";

type Props = {
  data: Array<Record<string, unknown>>;
  dataKey: string;
  nameKey?: string;
  color?: string;
  height?: number;
  colorByValue?: boolean;
  horizontal?: boolean;
  colors?: string[];
  positiveColor?: string;
  negativeColor?: string;
};

export function StyledBarChart({
  data, dataKey, nameKey = "name", color = CHART_COLORS.green,
  height = 200, colorByValue = false, horizontal = false,
  colors, positiveColor, negativeColor,
}: Props) {
  if (!data?.length) return null;

  const Chart = horizontal ? (
    <BarChart data={data} layout="vertical" margin={{ left: 40, right: 10, top: 5, bottom: 5 }}>
      <XAxis type="number" tick={{ fill: CHART_COLORS.textMuted, fontSize: 10 }} />
      <YAxis type="category" dataKey={nameKey} tick={{ fill: CHART_COLORS.textMuted, fontSize: 10 }} width={60} />
      <Tooltip
        contentStyle={{ background: CHART_COLORS.tooltip, border: `1px solid ${CHART_COLORS.border}`, fontSize: 11, fontFamily: "monospace" }}
        labelStyle={{ color: CHART_COLORS.text }}
        itemStyle={{ color: CHART_COLORS.green }}
      />
      <Bar dataKey={dataKey} fill={color} fillOpacity={0.7} radius={[0, 3, 3, 0]}>
        {(colorByValue || colors) && data.map((d, i) => (
          <Cell key={i} fill={colors ? (colors[i] || color) : Number(d[dataKey]) >= 0 ? (positiveColor || CHART_COLORS.green) : (negativeColor || CHART_COLORS.red)} fillOpacity={0.7} />
        ))}
      </Bar>
    </BarChart>
  ) : (
    <BarChart data={data} margin={{ left: 0, right: 0, top: 5, bottom: 5 }}>
      <XAxis dataKey={nameKey} tick={{ fill: CHART_COLORS.textMuted, fontSize: 10 }} />
      <YAxis tick={{ fill: CHART_COLORS.textMuted, fontSize: 10 }} width={40} />
      <Tooltip
        contentStyle={{ background: CHART_COLORS.tooltip, border: `1px solid ${CHART_COLORS.border}`, fontSize: 11, fontFamily: "monospace" }}
        labelStyle={{ color: CHART_COLORS.text }}
        itemStyle={{ color: CHART_COLORS.green }}
      />
      <Bar dataKey={dataKey} fill={color} fillOpacity={0.7} radius={[3, 3, 0, 0]}>
        {(colorByValue || colors) && data.map((d, i) => (
          <Cell key={i} fill={colors ? (colors[i] || color) : Number(d[dataKey]) >= 0 ? (positiveColor || CHART_COLORS.green) : (negativeColor || CHART_COLORS.red)} fillOpacity={0.7} />
        ))}
      </Bar>
    </BarChart>
  );

  return <ResponsiveContainer width="100%" height={height}>{Chart}</ResponsiveContainer>;
}
