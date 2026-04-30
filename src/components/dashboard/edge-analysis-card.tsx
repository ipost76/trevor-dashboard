"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  MetricTile,
  MoneyText,
  Pill,
  Skeleton,
  EmptyState,
} from "@/components/ui";
import { TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";

interface EdgeResponse {
  expectancy_pct: number;
  win_loss_ratio: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  best_pct: number;
  worst_pct: number;
  asymmetric: boolean;
  sample_n: number;
  data_available: boolean;
  message?: string | null;
}

export function EdgeAnalysisCard() {
  const [data, setData] = React.useState<EdgeResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  const fetchData = React.useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/edge", { cache: "no-store" });
      if (res.ok) setData((await res.json()) as EdgeResponse);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);
  React.useEffect(() => {
    const id = setInterval(fetchData, 120_000);
    return () => clearInterval(id);
  }, [fetchData]);

  return (
    <Card padding="md" className="space-y-3">
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2">
            {data?.asymmetric ? (
              <TrendingUp size={14} className="text-accent-green" />
            ) : (
              <AlertTriangle size={14} className="text-accent-amber" />
            )}
            EDGE ANALYSIS
          </span>
        </CardTitle>
        {data?.data_available && (
          <Pill tone={data.asymmetric ? "green" : "amber"} size="sm">
            {data.asymmetric ? "Asymmetric" : "Symmetric"}
          </Pill>
        )}
      </CardHeader>

      {loading && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {!loading && data && !data.data_available && (
        <EmptyState
          title="Edge analysis unavailable"
          body={data.message ?? "Need more closed trades to compute structural edge."}
          className="min-h-[100px]"
        />
      )}

      {!loading && data && data.data_available && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricTile
              label="Expectancy"
              value={
                <MoneyText
                  value={data.expectancy_pct}
                  unit="%"
                  size="md"
                  decimals={2}
                  showSign
                />
              }
              sub={`per trade · n=${data.sample_n}`}
            />
            <MetricTile
              label="W/L Ratio"
              value={data.win_loss_ratio.toFixed(2)}
              tone={data.win_loss_ratio >= 1.0 ? "positive" : "warn"}
              sub="win / |loss|"
            />
            <MetricTile
              label="Best"
              value={
                <MoneyText
                  value={data.best_pct}
                  unit="%"
                  size="md"
                  decimals={2}
                  showSign
                />
              }
              sub="single trade"
            />
            <MetricTile
              label="Worst"
              value={
                <MoneyText
                  value={data.worst_pct}
                  unit="%"
                  size="md"
                  decimals={2}
                  showSign
                />
              }
              sub="single trade"
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-caption text-fg-muted">
            <span className="flex items-center gap-1">
              <TrendingUp size={12} className="text-accent-green" />
              avg win <span className="text-accent-green">{data.avg_win_pct.toFixed(2)}%</span>
            </span>
            <span className="text-fg-faint">·</span>
            <span className="flex items-center gap-1">
              <TrendingDown size={12} className="text-accent-red" />
              avg loss <span className="text-accent-red">{data.avg_loss_pct.toFixed(2)}%</span>
            </span>
            <span className="text-fg-faint">·</span>
            <span title="Last 90 days of closed trades from unified_outcomes">90d window</span>
          </div>
        </>
      )}
    </Card>
  );
}
