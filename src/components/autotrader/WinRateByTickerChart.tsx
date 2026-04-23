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

// Win rate by ticker — green bar per ticker, count label on top, 50% ref.

type TickerRow = {
  ticker: string;
  total: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_pnl: number;
  avg_pnl_pct: number;
};

type Props = { data: TickerRow[]; height?: number };

function barColor(wr: number): string {
  if (wr >= 55) return CHART_COLORS.green;
  if (wr >= 45) return CHART_COLORS.amber;
  return CHART_COLORS.red;
}

export function WinRateByTickerChart({ data, height = 180 }: Props) {
  if (!data?.length) {
    return (
      <div
        className="flex items-center justify-center text-[11px]"
        style={{ height, color: CHART_COLORS.textMuted }}
      >
        no ticker data
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: 0, right: 10, top: 16, bottom: 4 }}>
        <XAxis
          dataKey="ticker"
          tick={{ fill: CHART_COLORS.textMuted, fontSize: 10 }}
          tickLine={{ stroke: CHART_COLORS.grid }}
          axisLine={{ stroke: CHART_COLORS.grid }}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: CHART_COLORS.textMuted, fontSize: 10 }}
          tickLine={{ stroke: CHART_COLORS.grid }}
          axisLine={{ stroke: CHART_COLORS.grid }}
          width={36}
          tickFormatter={(v) => `${v}`}
        />
        <Tooltip
          cursor={{ fill: "rgba(0,255,136,0.06)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0].payload as TickerRow;
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
                <div style={{ fontWeight: 600 }}>{row.ticker}</div>
                <div>
                  {row.wins}W / {row.losses}L ·{" "}
                  <span style={{ color: barColor(row.win_rate) }}>
                    {row.win_rate.toFixed(1)}%
                  </span>
                </div>
                <div style={{ color: pnlColor }}>
                  P&amp;L: {row.total_pnl >= 0 ? "+" : ""}${row.total_pnl.toFixed(2)}
                </div>
              </div>
            );
          }}
        />
        <ReferenceLine
          y={50}
          stroke={CHART_COLORS.textMuted}
          strokeDasharray="3 3"
          strokeOpacity={0.5}
        />
        <Bar dataKey="win_rate" radius={[3, 3, 0, 0]} fillOpacity={0.75}>
          {data.map((d, i) => (
            <Cell key={i} fill={barColor(d.win_rate)} />
          ))}
          <LabelList
            dataKey="total"
            position="top"
            fill={CHART_COLORS.textMuted}
            fontSize={10}
            fontFamily="monospace"
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
