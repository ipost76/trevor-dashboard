"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, Pill, Skeleton, EmptyState, SegmentedToggle } from "@/components/ui";
import { Target } from "lucide-react";

interface CalibrationBucket {
  bucket: string;
  trades: number;
  win_rate: number;
  avg_pnl_pct: number;
  expectancy: number;
}
interface DeepCalibration {
  global_buckets: ReadonlyArray<CalibrationBucket>;
  by_regime: Record<string, ReadonlyArray<CalibrationBucket>>;
  by_ticker: Record<string, ReadonlyArray<CalibrationBucket>>;
  data_available: boolean;
  total_rows?: number;
  error?: string;
}

type Slice = "global" | "regime" | "ticker";

const SLICE_OPTIONS = [
  { value: "global", label: "Global" },
  { value: "regime", label: "By Regime" },
  { value: "ticker", label: "By Ticker" },
] as const;

export function CalibrationSection() {
  const [data, setData] = React.useState<DeepCalibration | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [slice, setSlice] = React.useState<Slice>("global");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/intel/calibration", { cache: "no-store" });
        if (res.ok && !cancelled) setData(await res.json());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <Card padding="md" glow="cyan">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Target size={14} />
              CALIBRATION DEEP-DIVE
            </span>
          </CardTitle>
          {data?.total_rows != null && (
            <Pill tone="neutral" size="sm">{data.total_rows.toLocaleString()} trades</Pill>
          )}
        </CardHeader>

        <SegmentedToggle
          ariaLabel="Slice"
          options={SLICE_OPTIONS}
          value={slice}
          onChange={(s) => setSlice(s)}
          full
        />
      </Card>

      {loading && <Skeleton className="h-64 w-full" />}

      {!loading && data?.error && (
        <EmptyState title="Failed to load" body={data.error} />
      )}

      {!loading && data && !data.data_available && !data.error && (
        <EmptyState title="No calibration data" body="Need closed trades with confidence." />
      )}

      {!loading && data && data.data_available && slice === "global" && (
        <BucketBars title="GLOBAL" buckets={data.global_buckets} />
      )}

      {!loading && data && data.data_available && slice === "regime" && (
        <div className="space-y-3">
          {Object.entries(data.by_regime).map(([regime, buckets]) => (
            <BucketBars key={regime} title={regime || "—"} buckets={buckets} />
          ))}
        </div>
      )}

      {!loading && data && data.data_available && slice === "ticker" && (
        <div className="space-y-3">
          {Object.entries(data.by_ticker).map(([ticker, buckets]) => (
            <BucketBars key={ticker} title={ticker || "—"} buckets={buckets} />
          ))}
        </div>
      )}
    </div>
  );
}

type BucketTone = "neutral" | "green" | "cyan" | "amber" | "red";

function BucketBars({ title, buckets }: { title: string; buckets: ReadonlyArray<CalibrationBucket> }) {
  const totalTrades = buckets.reduce((s, b) => s + b.trades, 0);
  return (
    <Card padding="md">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <Pill tone="neutral" size="sm">{totalTrades} trades</Pill>
      </CardHeader>
      <ul className="divide-y divide-border-subtle">
        {buckets.map((b) => {
          let tone: BucketTone = "neutral";
          if (b.trades >= 5) {
            if (b.win_rate >= 55) tone = "green";
            else if (b.win_rate >= 40) tone = "cyan";
            else if (b.win_rate >= 30) tone = "amber";
            else tone = "red";
          }
          return (
            <li
              key={b.bucket}
              className="grid grid-cols-[80px_1fr_50px_60px] items-center gap-2 py-2.5 text-caption"
            >
              <Pill tone={tone} size="sm">{b.bucket}</Pill>
              <div className="relative h-2 rounded-full bg-bg-elevated overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-accent-cyan"
                  style={{ width: `${Math.max(0, Math.min(100, b.win_rate))}%` }}
                />
              </div>
              <span className="text-fg-muted text-right tabular-nums">{b.trades}</span>
              <span className="tabular-nums text-right">{b.win_rate.toFixed(1)}%</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
