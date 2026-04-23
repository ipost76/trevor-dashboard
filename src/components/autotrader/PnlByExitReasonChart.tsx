"use client";

import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_COLORS } from "@/components/charts/theme";

// Horizontal bar — total P&L per exit reason, green/red split at 0.
// Labels show "reason (count)" on the Y axis; tooltip adds avg pct.

type ExitReasonRow = {
  reason: string;
  count: number;
  total_pnl: number;
  avg_pnl_pct: number;
  color: string;
};

type Props = { data: ExitReasonRow[]; height?: number };

type Row = ExitReasonRow & { label: string };

export function PnlByExitReasonChart({ data, height = 150 }: Props) {
  const rows: Row[] = (data || [])
    .slice()
    // preserve server-side sort (by total_pnl desc)
    .map((r) => ({
      ...r,
      label: r.count > 0 ? `${r.reason} (${r.count})` : `${r.reason} (0)`,
    }));

  if (!rows.length) {
    return (
      <div
        className="flex items-center justify-center text-[11px]"
        style={{ height, color: CHART_COLORS.textMuted }}
      >
        no exit reason data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        layout="vertical"
        data={rows}
        margin={{ left: 120, right: 24, top: 4, bottom: 4 }}
      >
        <XAxis
          type="number"
          tick={{ fill: CHART_COLORS.textMuted, fontSize: 10 }}
          tickLine={{ stroke: CHART_COLORS.grid }}
          axisLine={{ stroke: CHART_COLORS.grid }}
          tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fill: CHART_COLORS.textMuted, fontSize: 10 }}
          tickLine={{ stroke: CHART_COLORS.grid }}
          axisLine={{ stroke: CHART_COLORS.grid }}
          width={120}
        />
        <Tooltip
          cursor={{ fill: "rgba(0,255,136,0.06)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0].payload as Row;
            const pnlColor = row.total_pnl >= 0 ? CHART_COLORS.green : CHART_COLORS.red;
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
                <div style={{ fontWeight: 600 }}>{row.reason}</div>
                <div>
                  {row.count} trade{row.count === 1 ? "" : "s"}
                </div>
                <div style={{ color: pnlColor }}>
                  Total: {row.total_pnl >= 0 ? "+" : ""}${row.total_pnl.toFixed(2)}
                </div>
                <div style={{ color: CHART_COLORS.textMuted }}>
                  Avg: {row.avg_pnl_pct >= 0 ? "+" : ""}
                  {row.avg_pnl_pct.toFixed(2)}%
                </div>
              </div>
            );
          }}
        />
        <ReferenceLine
          x={0}
          stroke={CHART_COLORS.textMuted}
          strokeOpacity={0.5}
        />
        <Bar dataKey="total_pnl" radius={[0, 3, 3, 0]} fillOpacity={0.75}>
          {rows.map((r, i) => (
            <Cell
              key={i}
              fill={r.total_pnl >= 0 ? CHART_COLORS.green : CHART_COLORS.red}
            />
          ))}
          <LabelList
            dataKey="total_pnl"
            position="right"
            fill={CHART_COLORS.textMuted}
            fontSize={10}
            fontFamily="monospace"
            formatter={(v: unknown) => {
              const n = Number(v);
              if (!isFinite(n) || n === 0) return "";
              return `${n >= 0 ? "+" : ""}$${n.toFixed(2)}`;
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
