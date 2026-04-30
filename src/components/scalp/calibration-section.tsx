"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  Pill,
  Skeleton,
  EmptyState,
} from "@/components/ui";
import { Target } from "lucide-react";
import { ResetControlsCard } from "./reset-controls-card";

interface CalibrationBucket {
  bucket: string;
  trades: number;
  win_rate: number; // already 0-100
  avg_pnl: number;
}

interface CalibrationResponse {
  buckets?: CalibrationBucket[];
  sweet_spot?: CalibrationBucket | null;
  dead_zone?: CalibrationBucket | null;
  data_available?: boolean;
  message?: string | null;
}

const SAMPLE_FLOOR = 5;

export function CalibrationSection() {
  const [data, setData] = React.useState<CalibrationResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const fetchBuckets = async () => {
      try {
        const res = await fetch("/api/dashboard/calibration", {
          cache: "no-store",
        });
        if (!cancelled && res.ok) {
          const j = (await res.json()) as CalibrationResponse;
          setData(j);
        }
      } catch {
        // keep last good
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchBuckets();
    const id = setInterval(fetchBuckets, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const buckets = data?.buckets ?? [];
  const sweet = data?.sweet_spot ?? null;
  const dead = data?.dead_zone ?? null;
  const hasData = data?.data_available === true && buckets.length > 0;

  return (
    <div className="space-y-4 p-4 animate-fade-in md:space-y-6 md:p-6 lg:px-8">
      <Card padding="md" glow="cyan">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Target size={14} />
              CALIBRATION · BUCKET PERFORMANCE
            </span>
          </CardTitle>
        </CardHeader>

        {loading && <Skeleton className="h-32 w-full" />}

        {!loading && !hasData && (
          <EmptyState
            title="No calibration data"
            body={
              data?.message ??
              `Buckets fill in after ≥${SAMPLE_FLOOR} closed trades each.`
            }
          />
        )}

        {!loading && hasData && (
          <>
            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {sweet && (
                <div className="rounded-md border border-accent-green/40 bg-accent-green/10 p-3">
                  <div className="text-micro uppercase text-fg-muted">
                    SWEET SPOT
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <Pill tone="green" size="md">
                      {sweet.bucket}
                    </Pill>
                    <span className="text-h1 font-bold tabular-nums text-accent-green">
                      {sweet.win_rate.toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-1 text-micro text-fg-muted">
                    {sweet.trades} trades · avg {sweet.avg_pnl.toFixed(2)}%
                  </div>
                </div>
              )}
              {dead && (
                <div className="rounded-md border border-accent-red/40 bg-accent-red/10 p-3">
                  <div className="text-micro uppercase text-fg-muted">
                    DEAD ZONE
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <Pill tone="red" size="md">
                      {dead.bucket}
                    </Pill>
                    <span className="text-h1 font-bold tabular-nums text-accent-red">
                      {dead.win_rate.toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-1 text-micro text-fg-muted">
                    {dead.trades} trades · avg {dead.avg_pnl.toFixed(2)}%
                  </div>
                </div>
              )}
            </div>

            <ul className="divide-y divide-border-subtle">
              {buckets.map((b) => {
                const tone =
                  b.win_rate >= 55
                    ? "green"
                    : b.win_rate >= 45
                    ? "cyan"
                    : b.win_rate >= 35
                    ? "amber"
                    : "red";
                const lowSample = b.trades < SAMPLE_FLOOR;
                return (
                  <li
                    key={b.bucket}
                    className="grid grid-cols-[80px_1fr_70px_70px] items-center gap-2 py-2.5"
                  >
                    <Pill tone={tone as "green" | "cyan" | "amber" | "red"} size="sm">
                      {b.bucket}
                    </Pill>
                    <div className="relative h-2 overflow-hidden rounded-full bg-bg-elevated">
                      <div
                        className="absolute inset-y-0 left-0 bg-accent-cyan"
                        style={{
                          width: `${Math.max(0, Math.min(100, b.win_rate))}%`,
                        }}
                      />
                    </div>
                    <span className="text-right text-caption font-mono tabular-nums">
                      {b.win_rate.toFixed(1)}%
                    </span>
                    <span
                      className={
                        "text-right text-micro " +
                        (lowSample ? "text-fg-faint italic" : "text-fg-muted")
                      }
                    >
                      {b.trades}
                      {lowSample ? " *" : ""}
                    </span>
                  </li>
                );
              })}
            </ul>

            <div className="mt-3 text-micro text-fg-muted">
              Buckets ≥{SAMPLE_FLOOR} trades count toward sweet / dead zone. Smaller
              samples shown but excluded from auto-flagging (marked *).
            </div>
          </>
        )}
      </Card>

      <ResetControlsCard />
    </div>
  );
}
