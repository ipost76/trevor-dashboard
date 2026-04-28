"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { CHART_COLORS } from "@/components/charts/theme";

type SlippageRow = {
  id: number;
  trade_id: number | null;
  ticker: string;
  direction: string | null;
  planned_price: number;
  actual_price: number;
  slippage_bps: number;
  slippage_pct: number;
  impact_usd: number | null;
  alerted: number;
  created_at: string;
};

type SlippageResponse = {
  rows: SlippageRow[];
  total: number;
  summary: {
    n: number;
    avg_bps: number;
    p50_bps: number;
    p95_bps: number;
    max_bps: number;
    alerted_count: number;
  };
  error?: string;
};

function pickColor(absBps: number): string {
  if (absBps >= 200) return CHART_COLORS.red ?? "#ff4757";
  if (absBps >= 50) return "#ffa502"; // amber
  return CHART_COLORS.green ?? "#00ff88";
}

function pickFormattedPrice(p: number): string {
  if (p >= 1000) return `$${p.toFixed(2)}`;
  if (p >= 1) return `$${p.toFixed(4)}`;
  return `$${p.toFixed(6)}`;
}

type ChartDatum = {
  name: string;
  bps: number;
  ticker: string;
  direction: string;
  planned: number;
  actual: number;
  impact: number | null;
  alerted: number;
};

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartDatum }[] }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div
      style={{
        background: CHART_COLORS.tooltip,
        border: `1px solid ${CHART_COLORS.border}`,
        padding: "8px 10px",
        fontSize: 11,
        fontFamily: "monospace",
        color: CHART_COLORS.text,
        borderRadius: 4,
      }}
    >
      <div style={{ color: CHART_COLORS.green, marginBottom: 4 }}>
        <strong>{d.ticker}</strong> {d.direction || ""} · {Math.abs(d.bps).toFixed(2)} bps
        {d.alerted ? " ⚠️" : ""}
      </div>
      <div>Planned: {pickFormattedPrice(d.planned)}</div>
      <div>Actual: {pickFormattedPrice(d.actual)}</div>
      {d.impact !== null ? <div>Impact: ${d.impact.toFixed(4)}</div> : null}
    </div>
  );
}

export function SlippageHistogram() {
  const [data, setData] = useState<SlippageResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/auto-trader/slippage?limit=100");
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as SlippageResponse;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 60_000); // 60s refresh — matches API cache
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const rows = data?.rows ?? [];
  const summary = data?.summary;

  // Map to bar-chart shape
  const chartData: ChartDatum[] = rows.map((r) => ({
    name: `#${r.id}`,
    bps: Math.abs(r.slippage_bps),
    ticker: r.ticker,
    direction: r.direction || "",
    planned: r.planned_price,
    actual: r.actual_price,
    impact: r.impact_usd,
    alerted: r.alerted,
  }));

  if (loading && !data) {
    return (
      <div
        className="rounded-lg border p-3"
        style={{ background: "#12131a", borderColor: "#1e2030", height: 180 }}
      >
        <div className="text-[10px] uppercase tracking-[0.1em]" style={{ color: "#8888a0" }}>
          Slippage (loading…)
        </div>
      </div>
    );
  }

  if (!chartData.length) {
    return (
      <div
        className="rounded-lg border p-3"
        style={{ background: "#12131a", borderColor: "#1e2030" }}
      >
        <div
          className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.1em]"
          style={{ color: "#8888a0" }}
        >
          <span>Slippage (last 100 fills)</span>
        </div>
        <div className="py-6 text-center text-xs" style={{ color: "#8888a0" }}>
          No slippage data yet — first fills will populate here.
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border p-3"
      style={{ background: "#12131a", borderColor: "#1e2030" }}
    >
      <div
        className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.1em]"
        style={{ color: "#8888a0" }}
      >
        <span>Slippage (bps · last {chartData.length} fills)</span>
        {summary ? (
          <span className="opacity-70 normal-case tracking-normal">
            avg {summary.avg_bps.toFixed(1)} · p95 {summary.p95_bps.toFixed(1)} · max {summary.max_bps.toFixed(1)}
            {summary.alerted_count > 0 ? ` · ${summary.alerted_count} ⚠️` : ""}
          </span>
        ) : null}
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={chartData} margin={{ left: 0, right: 0, top: 5, bottom: 5 }}>
          <XAxis
            dataKey="name"
            tick={{ fill: CHART_COLORS.textMuted, fontSize: 9 }}
            interval={Math.max(0, Math.floor(chartData.length / 12))}
          />
          <YAxis tick={{ fill: CHART_COLORS.textMuted, fontSize: 10 }} width={36} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey="bps" radius={[3, 3, 0, 0]}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={pickColor(d.bps)} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-1 text-[9px] opacity-60" style={{ color: "#8888a0" }}>
        green &lt;50 · amber 50-200 · red ≥200 bps
      </div>
    </div>
  );
}
