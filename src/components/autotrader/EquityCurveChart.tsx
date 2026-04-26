"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_COLORS } from "@/components/charts/theme";

// Equity curve — split into two series (live vs paper) so the page can
// show both lines, or filter to one. Live is the bright #00ff88 hero color.
// Paper is dimmed (#666) since most/all early trades will be paper.
//
// X-axis is the merged trade index (1..N) across both modes; live and paper
// running totals are tracked at every step on the backend, so each line is
// continuous over the full timeline.

type Point = {
  trade_id: number;
  ticker: string;
  direction: string;
  trade_mode: "live" | "paper";
  pnl_usd: number;
  closed_at: string;
  equity: number;
  live_equity: number;
  paper_equity: number;
  pnl_cumulative: number;
};

type Props = {
  points: Point[];
  startingCapital: number;
  height?: number;
  show: "live" | "paper" | "both";
  liveCount?: number;
};

type Row = Point & { idx: number };

const LIVE_COLOR = "#00ff88";
const PAPER_COLOR = "#7a7a8a";
const REF_COLOR = "#8888a0";

export function EquityCurveChart({
  points,
  startingCapital,
  height = 220,
  show,
  liveCount = 0,
}: Props) {
  const data = useMemo<Row[]>(
    () => points.map((p, i) => ({ ...p, idx: i + 1 })),
    [points]
  );

  const { yMin, yMax } = useMemo(() => {
    if (!data.length) {
      return { yMin: startingCapital - 1, yMax: startingCapital + 1 };
    }
    const vals: number[] = [startingCapital];
    if (show !== "paper") vals.push(...data.map((d) => d.live_equity));
    if (show !== "live") vals.push(...data.map((d) => d.paper_equity));
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    const pad = Math.max(0.05, (max - min) * 0.08);
    return { yMin: min - pad, yMax: max + pad };
  }, [data, startingCapital, show]);

  const showLive = show === "live" || show === "both";
  const showPaper = show === "paper" || show === "both";
  const noLiveTrades = liveCount === 0;

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
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={data}
          margin={{ left: 0, right: 8, top: 8, bottom: 4 }}
        >
          <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
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
            cursor={{ stroke: CHART_COLORS.grid, strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as Row;
              const total = row.live_equity + row.paper_equity - 2 * startingCapital;
              const totalColor = total >= 0 ? CHART_COLORS.green : CHART_COLORS.red;
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
                    <span
                      style={{
                        marginLeft: 6,
                        padding: "0 4px",
                        fontSize: 9,
                        letterSpacing: "0.1em",
                        background: row.trade_mode === "live" ? `${LIVE_COLOR}22` : `${PAPER_COLOR}22`,
                        color: row.trade_mode === "live" ? LIVE_COLOR : PAPER_COLOR,
                        border: `1px solid ${row.trade_mode === "live" ? LIVE_COLOR : PAPER_COLOR}55`,
                      }}
                    >
                      {row.trade_mode.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ color: LIVE_COLOR }}>
                    Live: ${row.live_equity.toFixed(2)}
                  </div>
                  <div style={{ color: PAPER_COLOR }}>
                    Paper: ${row.paper_equity.toFixed(2)}
                  </div>
                  <div style={{ color: tColor, opacity: 0.85 }}>
                    Δ: {row.pnl_usd >= 0 ? "+" : ""}${row.pnl_usd.toFixed(2)}
                  </div>
                  <div style={{ color: totalColor, opacity: 0.7, fontSize: 10 }}>
                    combined: {total >= 0 ? "+" : ""}${total.toFixed(2)}
                  </div>
                </div>
              );
            }}
          />

          <ReferenceLine
            y={startingCapital}
            stroke={REF_COLOR}
            strokeDasharray="3 3"
            strokeOpacity={0.5}
            label={{
              value: `$${startingCapital.toFixed(0)}`,
              fill: REF_COLOR,
              fontSize: 9,
              position: "insideLeft",
            }}
          />

          {showLive && (
            <Line
              type="monotone"
              dataKey="live_equity"
              name="Live"
              stroke={LIVE_COLOR}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          )}
          {showPaper && (
            <Line
              type="monotone"
              dataKey="paper_equity"
              name="Paper"
              stroke={PAPER_COLOR}
              strokeWidth={1.5}
              strokeDasharray={showLive && showPaper ? "5 4" : undefined}
              dot={false}
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>

      {/* Live-empty placeholder */}
      {showLive && noLiveTrades && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          style={{ color: LIVE_COLOR }}
        >
          <div
            className="rounded px-3 py-1.5 text-[10px] uppercase tracking-[0.12em]"
            style={{
              background: "rgba(0,255,136,0.06)",
              border: `1px solid ${LIVE_COLOR}55`,
              fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
            }}
          >
            🟢 live trades will appear here
          </div>
        </div>
      )}
    </div>
  );
}
