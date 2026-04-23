"use client";

import { useMemo } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_COLORS } from "@/components/charts/theme";

// Equity curve — line with area fill that flips green/red at the starting
// capital line (default $50). Uses Recharts defs/linearGradient offsets so
// the color crossover happens exactly at the threshold, not at zero.

type Point = {
  trade_id: number;
  ticker: string;
  direction: string;
  pnl_usd: number;
  closed_at: string;
  equity: number;
  pnl_cumulative: number;
};

type Props = {
  points: Point[];
  startingCapital: number;
  height?: number;
};

type RowChart = Point & { idx: number };

export function EquityCurveChart({ points, startingCapital, height = 200 }: Props) {
  const data = useMemo<RowChart[]>(
    () => points.map((p, i) => ({ ...p, idx: i + 1 })),
    [points]
  );

  const { offset, yMin, yMax } = useMemo(() => {
    if (!data.length) {
      return {
        offset: 0.5,
        yMin: startingCapital - 1,
        yMax: startingCapital + 1,
      };
    }
    const eqs = data.map((d) => d.equity);
    const max = Math.max(...eqs, startingCapital);
    const min = Math.min(...eqs, startingCapital);
    const pad = Math.max(0.01, (max - min) * 0.08);
    const yMax = max + pad;
    const yMin = min - pad;
    // offset is 0 at top of SVG, 1 at bottom. stop with offset=x means
    // color applies above the line at height x*total.
    const range = yMax - yMin;
    const offset = range > 0 ? Math.min(1, Math.max(0, (yMax - startingCapital) / range)) : 0.5;
    return { offset, yMin, yMax };
  }, [data, startingCapital]);

  if (!data.length) {
    return (
      <div
        className="flex items-center justify-center text-[11px]"
        style={{ height, color: CHART_COLORS.textMuted }}
      >
        no closed trades yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={data}
        margin={{ left: 0, right: 8, top: 8, bottom: 4 }}
      >
        <defs>
          <linearGradient id="eqStroke" x1="0" y1="0" x2="0" y2="1">
            <stop offset={offset} stopColor={CHART_COLORS.green} stopOpacity={1} />
            <stop offset={offset} stopColor={CHART_COLORS.red} stopOpacity={1} />
          </linearGradient>
          <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset={offset} stopColor={CHART_COLORS.green} stopOpacity={0.22} />
            <stop offset={offset} stopColor={CHART_COLORS.green} stopOpacity={0.04} />
            <stop offset={offset} stopColor={CHART_COLORS.red} stopOpacity={0.04} />
            <stop offset={offset} stopColor={CHART_COLORS.red} stopOpacity={0.22} />
          </linearGradient>
        </defs>

        <XAxis
          dataKey="idx"
          tick={{ fill: CHART_COLORS.textMuted, fontSize: 10 }}
          tickLine={{ stroke: CHART_COLORS.grid }}
          axisLine={{ stroke: CHART_COLORS.grid }}
          label={{
            value: "trade #",
            fill: CHART_COLORS.textMuted,
            fontSize: 9,
            position: "insideBottomRight",
            offset: -2,
          }}
        />
        <YAxis
          domain={[yMin, yMax]}
          tick={{ fill: CHART_COLORS.textMuted, fontSize: 10 }}
          tickLine={{ stroke: CHART_COLORS.grid }}
          axisLine={{ stroke: CHART_COLORS.grid }}
          width={52}
          tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
        />

        <Tooltip
          contentStyle={{
            background: CHART_COLORS.tooltip,
            border: `1px solid ${CHART_COLORS.border}`,
            fontSize: 11,
            fontFamily: "monospace",
            padding: "6px 8px",
          }}
          labelStyle={{ color: CHART_COLORS.text, fontWeight: 600 }}
          itemStyle={{ color: CHART_COLORS.green }}
          cursor={{ stroke: CHART_COLORS.grid, strokeWidth: 1 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0].payload as RowChart;
            const pnlColor =
              row.pnl_cumulative >= 0 ? CHART_COLORS.green : CHART_COLORS.red;
            const tColor = row.pnl_usd >= 0 ? CHART_COLORS.green : CHART_COLORS.red;
            return (
              <div
                style={{
                  background: CHART_COLORS.tooltip,
                  border: `1px solid ${CHART_COLORS.border}`,
                  padding: "6px 8px",
                  fontFamily: "monospace",
                  fontSize: 11,
                  color: CHART_COLORS.text,
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  Trade #{row.idx} · {row.ticker} {row.direction}
                </div>
                <div>Equity: ${row.equity.toFixed(2)}</div>
                <div style={{ color: pnlColor }}>
                  Cum: {row.pnl_cumulative >= 0 ? "+" : ""}${row.pnl_cumulative.toFixed(2)}
                </div>
                <div style={{ color: tColor, opacity: 0.85 }}>
                  Δ: {row.pnl_usd >= 0 ? "+" : ""}${row.pnl_usd.toFixed(2)}
                </div>
              </div>
            );
          }}
        />

        <ReferenceLine
          y={startingCapital}
          stroke={CHART_COLORS.textMuted}
          strokeDasharray="3 3"
          strokeOpacity={0.5}
          label={{
            value: `$${startingCapital.toFixed(0)}`,
            fill: CHART_COLORS.textMuted,
            fontSize: 9,
            position: "insideLeft",
          }}
        />

        <Area
          type="monotone"
          dataKey="equity"
          stroke="none"
          fill="url(#eqFill)"
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="equity"
          stroke="url(#eqStroke)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
