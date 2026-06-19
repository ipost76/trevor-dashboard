"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, MetricTile, Pill, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { GitCompareArrows } from "lucide-react";

// B4 — Data-Freshness & Drift card (READ-ONLY display).
//
// Home for the "2 open vs 3" confusion: surfaces the LIVE heartbeat open-count
// vs the lagging-replica open-count + the replica file age, labelled as
// *lagging/expected* (not *wrong*). Reads /api/hub/drift-state (30s poll).
// Reuses Card / MetricTile / Pill — no new design language.
//
//   delta === 0                     → mint "IN SYNC"
//   delta !== 0 & age ≤ ~30m window → gold "LAGGING (replica ~Nm — expected)"
//   delta !== 0 & age > ~30m window → red  "STALE beyond window"
//   heartbeat unreachable           → neutral "LIVE UNAVAILABLE" (replica only)

const ENDPOINT = "/api/hub/drift-state";
const POLL_MS = 30_000;
// ~30m: the litestream replica restores every ~15m (trevor-restore.timer) and a
// full restore takes ~8–14m → effective freshness ~20–30m. A delta inside this
// window is expected lag; beyond it the continuous-restore pipeline is stalled.
const RESTORE_WINDOW_SECONDS = 30 * 60;

interface DriftState {
  live_count: number | null;
  replica_count: number | null;
  drift_delta: number | null;
  drift: boolean | null;
  replica_age_seconds: number | null;
  replica_mtime: string | null;
  live_source: string;
  errors?: { live: string | null; replica: string | null; replica_age: string | null };
}

type FreshState = "in-sync" | "lagging" | "stale" | "unknown";

function fmtAge(seconds: number | null): string {
  if (seconds == null) return "?";
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function computeState(d: DriftState): FreshState {
  if (d.live_count === null || d.drift_delta === null) return "unknown";
  if (d.drift_delta === 0) return "in-sync";
  const age = d.replica_age_seconds;
  if (age !== null && age > RESTORE_WINDOW_SECONDS) return "stale";
  return "lagging";
}

export function DataFreshnessCard() {
  const [data, setData] = React.useState<DriftState | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const fetchState = async () => {
      try {
        const res = await fetch(ENDPOINT, { cache: "no-store" });
        if (res.ok && !cancelled) setData((await res.json()) as DriftState);
      } catch {
        /* keep prior data on transient errors */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchState();
    const id = setInterval(() => void fetchState(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const state: FreshState = data ? computeState(data) : "unknown";
  const ageStr = data ? fmtAge(data.replica_age_seconds) : "?";

  const META: Record<
    FreshState,
    { border: string; pill: React.ReactNode; explain: (d: DriftState) => string }
  > = {
    "in-sync": {
      border: "border-l-accent-mint",
      pill: (
        <Pill intent="live" size="sm">
          IN SYNC
        </Pill>
      ),
      explain: (d) =>
        `Live heartbeat and the replica agree — ${d.live_count} open. No drift.`,
    },
    lagging: {
      border: "border-l-accent-gold",
      pill: (
        <Pill intent="warn" size="sm">
          LAGGING
        </Pill>
      ),
      explain: (d) =>
        `Replica is ~${ageStr} behind live (Δ ${d.drift_delta! > 0 ? "+" : ""}${d.drift_delta}) — expected, not an error. Live/open numbers come from the heartbeat; the replica restores every ~15m.`,
    },
    stale: {
      border: "border-l-accent-red",
      pill: (
        <Pill intent="error" size="sm">
          STALE
        </Pill>
      ),
      explain: (d) =>
        `Replica is ~${ageStr} old — beyond the ~30m restore window (Δ ${d.drift_delta! > 0 ? "+" : ""}${d.drift_delta}). The continuous-restore pipeline may be stalled.`,
    },
    unknown: {
      border: "border-l-accent-cyan-soft",
      pill: (
        <Pill tone="neutral" size="sm">
          LIVE UNAVAILABLE
        </Pill>
      ),
      explain: (d) =>
        d.replica_count !== null
          ? `Heartbeat unreachable — showing the replica open-count only (${d.replica_count}); drift can't be computed right now.`
          : `Both the heartbeat and the replica are unreachable — drift can't be computed right now.`,
    },
  };

  const meta = META[state];

  return (
    <Card padding="md" className={cn("border-l-4", data ? meta.border : "border-l-border-subtle")}>
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2 uppercase tracking-wider">
            <GitCompareArrows size={14} aria-hidden />
            Data Freshness &amp; Drift
          </span>
        </CardTitle>
        {data && meta.pill}
      </CardHeader>

      {loading && !data && <Skeleton className="h-20 w-full" />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <MetricTile
              label="LIVE · heartbeat"
              value={data.live_count !== null ? data.live_count : "—"}
              sub="open positions"
              size="sm"
            />
            <MetricTile
              label={`REPLICA · ~${ageStr} old`}
              value={data.replica_count !== null ? data.replica_count : "—"}
              sub="open positions"
              size="sm"
            />
          </div>
          <p className="mt-3 text-caption leading-relaxed text-fg-muted">
            {meta.explain(data)}
          </p>
        </>
      )}
    </Card>
  );
}
