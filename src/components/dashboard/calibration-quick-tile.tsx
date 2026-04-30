"use client";
import * as React from "react";
import Link from "next/link";
import {
  Card,
  CardHeader,
  CardTitle,
  Pill,
  Skeleton,
  EmptyState,
} from "@/components/ui";
import { Target, ChevronRight } from "lucide-react";

interface CalibrationBucket {
  bucket: string;
  trades: number;
  win_rate: number; // 0-100 (script multiplies before emit)
  avg_pnl?: number;
}
interface CalibrationResponse {
  buckets: ReadonlyArray<CalibrationBucket>;
  sweet_spot?: CalibrationBucket | null;
  dead_zone?: CalibrationBucket | null;
  data_available: boolean;
  message?: string | null;
}

// Honesty rule (Ghost-approved): only buckets with WR >= 55 earn the green
// "sweet" treatment. WR 45-54 (incl. exactly 50.0) is amber + "fragile edge"
// sublabel. Below 45 stays red. Dead zone is always red regardless of value
// since it's the worst eligible bucket.
function sweetTone(wr: number): "green" | "amber" | "red" {
  if (wr >= 55) return "green";
  if (wr >= 45) return "amber";
  return "red";
}

function sweetLabel(wr: number): string | null {
  if (wr >= 55) return null;
  if (wr >= 45) return "fragile edge";
  return "below breakeven";
}

export function CalibrationQuickTile() {
  const [data, setData] = React.useState<CalibrationResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const res = await fetch("/api/dashboard/calibration", { cache: "no-store" });
        if (res.ok) {
          const j = (await res.json()) as CalibrationResponse;
          if (!cancelled) setData(j);
        } else if (!cancelled) {
          setData({
            buckets: [],
            sweet_spot: null,
            dead_zone: null,
            data_available: false,
            message: "Calibration endpoint unreachable.",
          });
        }
      } catch {
        if (!cancelled) {
          setData({
            buckets: [],
            sweet_spot: null,
            dead_zone: null,
            data_available: false,
            message: "Failed to load calibration.",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    const id = setInterval(fetchData, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const sweet = data?.sweet_spot ?? null;
  const dead = data?.dead_zone ?? null;
  const sweetTn = sweet ? sweetTone(sweet.win_rate) : "amber";
  const sweetSub = sweet ? sweetLabel(sweet.win_rate) : null;

  return (
    <Card padding="md" className="group transition-shadow duration-fast hover:shadow-glow-cyan">
      <Link href="/intel?tab=calibration" className="block">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Target size={14} className="text-accent-cyan" />
              CALIBRATION
            </span>
          </CardTitle>
          <ChevronRight
            size={16}
            className="text-fg-muted transition-colors duration-fast group-hover:text-accent-cyan"
          />
        </CardHeader>

        {loading && <Skeleton className="h-24 w-full" />}

        {!loading && data && !data.data_available && (
          <EmptyState
            title="No calibration data"
            body={data.message ?? "Tap to view full calibration analysis."}
            className="min-h-[80px]"
          />
        )}

        {!loading && data && data.data_available && (
          <div className="grid grid-cols-2 gap-3">
            {sweet && (
              <div className="space-y-1">
                <div className="text-micro text-fg-muted">SWEET SPOT</div>
                <Pill tone={sweetTn} size="md">
                  {sweet.bucket}
                </Pill>
                <div
                  className={
                    sweetTn === "green"
                      ? "text-h3 tabular-nums text-accent-green"
                      : sweetTn === "amber"
                      ? "text-h3 tabular-nums text-accent-amber"
                      : "text-h3 tabular-nums text-accent-red"
                  }
                >
                  {sweet.win_rate.toFixed(1)}%
                </div>
                <div className="text-micro text-fg-muted">
                  {sweet.trades} trades{sweetSub ? ` · ${sweetSub}` : ""}
                </div>
              </div>
            )}
            {dead && (
              <div className="space-y-1">
                <div className="text-micro text-fg-muted">DEAD ZONE</div>
                <Pill tone="red" size="md">
                  {dead.bucket}
                </Pill>
                <div className="text-h3 tabular-nums text-accent-red">
                  {dead.win_rate.toFixed(1)}%
                </div>
                <div className="text-micro text-fg-muted">{dead.trades} trades</div>
              </div>
            )}
          </div>
        )}

        <div className="pt-3 text-caption text-fg-muted">Tap to view full calibration →</div>
      </Link>
    </Card>
  );
}
