"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, MetricTile, Pill, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Snowflake } from "lucide-react";

// Wedge-Rate tile [B2] — READ-ONLY at-a-glance loop-freeze regression signal.
//
// The tile Ghost watches each gated FREEZE fix against: today's loop-freeze
// count (big number), the 7-day trend (mini bars), the worst stall today, the
// last boot, plus a green/amber/red state. Reads /api/hub/wedge-metrics (60s
// poll) which serves the VM's logs/wedge_metrics.json ([B1] contract) via the
// read-only `ssh vm` pipe. Consumes the [B1] shape EXACTLY — no log parsing here.
//
// Resilient by construction: never crashes, never blanks. States —
//   status "ok"       → render metrics; border color = alert_state (green/amber/red)
//   status "no_data"  → clean "No data yet" (B1 not deployed / file absent)
//   status "error"    → clean "Metrics unavailable" (VM unreachable / mid-write)
//   stale_minutes > N → "updated Xm ago" flagged stale (numbers may be old)

const ENDPOINT = "/api/hub/wedge-metrics";
const POLL_MS = 60_000;
// Conservative freshness bound: the [B1] job regenerates on a minutes cadence, so
// data older than this means the generator hasn't refreshed in a while — flag it.
const STALE_MINUTES = 30;

interface WedgeDay {
  date?: string;
  wedge_count?: number;
  max_age_s?: number;
  sigabrt_count?: number;
}
interface WedgeBoot {
  at?: string;
  duration_s?: number;
}
interface WedgeThresholds {
  daily_count?: number;
  age_s?: number;
  boot_s?: number;
}
interface WedgeMetrics {
  status?: string; // "ok" | "no_data" | "error"
  generated_at?: string;
  today?: WedgeDay;
  series_7d?: WedgeDay[];
  last_boot?: WedgeBoot;
  alert_state?: string; // "green" | "amber" | "red"
  thresholds?: WedgeThresholds;
  stale_minutes?: number | null;
  error?: string;
}

// SVG token colors (CSS vars resolve inside `fill`).
const C_MINT = "var(--color-accent-mint)";
const C_RED = "var(--color-accent-red)";
const C_MUTED = "var(--color-fg-muted)";

const ALERT_META: Record<
  string,
  { border: string; pill: React.ReactNode }
> = {
  green: {
    border: "border-l-accent-mint",
    pill: (
      <Pill intent="live" size="sm">
        STABLE
      </Pill>
    ),
  },
  amber: {
    border: "border-l-accent-gold",
    pill: (
      <Pill intent="warn" size="sm">
        ELEVATED
      </Pill>
    ),
  },
  red: {
    border: "border-l-accent-red",
    pill: (
      <Pill intent="error" size="sm">
        REGRESSED
      </Pill>
    ),
  },
};

function fmtSecs(s: number | null | undefined): string {
  if (s == null || Number.isNaN(s)) return "—";
  if (s < 90) return `${Math.round(s)}s`;
  return `${(s / 60).toFixed(1)}m`;
}

function fmtStale(m: number | null | undefined): string {
  if (m == null) return "updated —";
  if (m < 1) return "updated just now";
  if (m < 90) return `updated ${m}m ago`;
  return `updated ${Math.round(m / 60)}h ago`;
}

// Mini 7-day trend: one bar per series point, height ∝ wedge_count. A day at/over
// the daily_count threshold is a freeze day → red; under → mint. Empty → nothing.
function TrendBars({ series, threshold }: { series: WedgeDay[]; threshold: number | undefined }) {
  if (!series.length) {
    return <p className="text-micro text-fg-faint">no 7-day history yet</p>;
  }
  const counts = series.map((d) => Math.max(0, d.wedge_count ?? 0));
  const max = Math.max(...counts, 1);
  const W = 140;
  const H = 34;
  const gap = 3;
  const n = series.length;
  const bw = Math.max(2, (W - gap * (n - 1)) / n);
  const over = (c: number) => threshold != null && c >= threshold && c > 0;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-9 w-full"
      role="img"
      aria-label="Loop-freeze count, last 7 days"
    >
      {series.map((d, i) => {
        const c = counts[i];
        const bh = c === 0 ? 1.5 : Math.max(2, (c / max) * (H - 2));
        const x = i * (bw + gap);
        return (
          <rect
            key={d.date ?? i}
            x={x}
            y={H - bh}
            width={bw}
            height={bh}
            fill={c === 0 ? C_MUTED : over(c) ? C_RED : C_MINT}
            opacity={c === 0 ? 0.4 : 0.8}
          >
            <title>{`${d.date ?? "?"}: ${c} wedge${c === 1 ? "" : "s"}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export function WedgeRateTile() {
  const [data, setData] = React.useState<WedgeMetrics | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(ENDPOINT, { cache: "no-store" });
        if (res.ok && !cancelled) setData((await res.json()) as WedgeMetrics);
      } catch {
        /* keep prior data on a transient error — never blank */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const Header = ({ right }: { right?: React.ReactNode }) => (
    <CardHeader>
      <CardTitle>
        <span className="flex items-center gap-2 uppercase tracking-wider">
          <Snowflake size={14} aria-hidden />
          Wedge Rate
        </span>
      </CardTitle>
      {right}
    </CardHeader>
  );

  // Loading (first paint, no data yet).
  if (loading && !data) {
    return (
      <Card padding="md" className="border-l-4 border-l-border-subtle">
        <Header />
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }

  const status = data?.status;

  // No data yet — B1 not deployed / file absent. Clean, honest, inviting.
  if (status === "no_data" || !data) {
    return (
      <Card padding="md" className="border-l-4 border-l-border-subtle">
        <Header
          right={
            <Pill tone="neutral" size="sm">
              NO DATA
            </Pill>
          }
        />
        <p className="text-caption leading-relaxed text-fg-muted">
          No wedge metrics yet — the loop-freeze signal lights up once the VM job
          publishes <code className="text-accent-cyan-soft">logs/wedge_metrics.json</code>.
        </p>
      </Card>
    );
  }

  // Error — VM unreachable / mid-write malformed. Never blank; surface honestly.
  if (status !== "ok") {
    return (
      <Card padding="md" className="border-l-4 border-l-accent-gold">
        <Header
          right={
            <Pill tone="neutral" size="sm">
              UNAVAILABLE
            </Pill>
          }
        />
        <p className="text-caption leading-relaxed text-fg-muted">
          Wedge metrics unavailable right now — {data.error ?? "the VM read failed"}.
          {" "}Showing nothing rather than a stale number; retries automatically.
        </p>
      </Card>
    );
  }

  // OK — render the metrics.
  const today = data.today ?? {};
  const series = data.series_7d ?? [];
  const boot = data.last_boot ?? {};
  const thresholds = data.thresholds ?? {};
  const alert = (data.alert_state ?? "green").toLowerCase();
  const meta = ALERT_META[alert] ?? ALERT_META.green;
  const stale = data.stale_minutes != null && data.stale_minutes > STALE_MINUTES;
  const wedgeCount = today.wedge_count ?? 0;

  return (
    <Card padding="md" className={cn("border-l-4", meta.border)}>
      <Header right={meta.pill} />

      <div className="grid grid-cols-2 gap-3">
        <MetricTile
          label="WEDGES TODAY"
          value={wedgeCount}
          sub={
            thresholds.daily_count != null
              ? `threshold ${thresholds.daily_count}`
              : "loop freezes"
          }
        />
        <div className="flex flex-col justify-center">
          <span className="mb-1 text-micro uppercase tracking-wider text-fg-muted">
            7-day trend
          </span>
          <TrendBars series={series} threshold={thresholds.daily_count} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <MetricTile label="WORST STALL" value={fmtSecs(today.max_age_s)} sub="today" size="sm" />
        <MetricTile label="LAST BOOT" value={fmtSecs(boot.duration_s)} sub="startup" size="sm" />
        <MetricTile
          label="SIGABRT"
          value={today.sigabrt_count ?? 0}
          sub="today"
          size="sm"
        />
      </div>

      <p
        className={cn(
          "mt-3 text-micro",
          stale ? "text-accent-gold" : "text-fg-faint",
        )}
      >
        {stale ? "⚠ stale · " : ""}
        {fmtStale(data.stale_minutes)}
      </p>
    </Card>
  );
}
