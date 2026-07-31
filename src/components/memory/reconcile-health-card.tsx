"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  MetricTile,
  Pill,
  EmptyState,
  Skeleton,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { plainMismatchKind } from "@/lib/plain-labels";
import { RefreshCw } from "lucide-react";

// B4 — Reconcile-Health card (READ-ONLY display).
//
// The bot's DB↔HL reconcile status — last reconcile time, matched/unmatched
// counts, per-mismatch-kind breakdown, and the stuck-queue flag. Sourced from
// the heartbeat `reconcile` category (Phase 2 — VM adds it to the Observatory
// collector, primary source `gap_watchdog_shadow` + `gap_watchdog_state` +
// `position_reconcile_queue`). Reads it through the existing /api/heartbeat
// proxy (30s poll).
//
// GRACEFUL ABSENCE: until Phase 2 lands the category (or if the heartbeat is
// unreachable), this renders a clean EmptyState / Skeleton — it NEVER errors.

const ENDPOINT = "/api/heartbeat";
const POLL_MS = 30_000;

interface MismatchKind {
  kind: string;
  count: number;
}
interface ReconcileCat {
  status?: "ok" | "warning" | "critical" | string;
  last_reconcile_ts?: string | null;
  last_reconcile_ago_seconds?: number | null;
  hl_count?: number | null;
  db_count?: number | null;
  matched?: number | null;
  gaps_found?: number | null;
  open_mismatches?: MismatchKind[];
  queue_pending?: number | null;
  queue_escalated?: number | null;
  oldest_unresolved_age_seconds?: number | null;
  stuck?: boolean;
  details?: string[];
}
interface HeartbeatShape {
  categories?: { reconcile?: ReconcileCat };
  error?: string;
}

function fmtAge(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function statusPill(status: string | undefined): React.ReactNode {
  if (status === "critical")
    return (
      <Pill intent="error" size="sm">
        CRITICAL
      </Pill>
    );
  if (status === "warning")
    return (
      <Pill intent="warn" size="sm">
        WARNING
      </Pill>
    );
  if (status === "ok")
    return (
      <Pill intent="live" size="sm">
        OK
      </Pill>
    );
  return null;
}

function borderClass(status: string | undefined): string {
  if (status === "critical") return "border-l-accent-red";
  if (status === "warning") return "border-l-accent-gold";
  if (status === "ok") return "border-l-accent-mint";
  return "border-l-border-subtle";
}

export function ReconcileHealthCard() {
  const [recon, setRecon] = React.useState<ReconcileCat | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const fetchRecon = async () => {
      try {
        const res = await fetch(ENDPOINT, { cache: "no-store" });
        if (res.ok && !cancelled) {
          const data = (await res.json()) as HeartbeatShape;
          setRecon(data.categories?.reconcile ?? null);
        } else if (!cancelled) {
          // Heartbeat unreachable (502/503) → category unavailable, EmptyState.
          setRecon(null);
        }
      } catch {
        if (!cancelled) setRecon(null);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void fetchRecon();
    const id = setInterval(() => void fetchRecon(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const mismatches = recon?.open_mismatches ?? [];

  return (
    <Card padding="md" className={cn("border-l-4", borderClass(recon?.status))}>
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2 uppercase tracking-wider">
            <RefreshCw size={14} aria-hidden />
            Reconcile Health
          </span>
        </CardTitle>
        {recon && statusPill(recon.status)}
      </CardHeader>

      {!loaded && <Skeleton className="h-20 w-full" />}

      {loaded && !recon && (
        <EmptyState
          icon={<RefreshCw size={28} />}
          title="Reconcile telemetry pending"
          body="Trade-reconciliation data isn't being published yet."
        />
      )}

      {recon && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3">
            <MetricTile
              label="HL"
              value={recon.hl_count ?? "—"}
              sub="positions"
              size="sm"
            />
            <MetricTile
              label="DB"
              value={recon.db_count ?? "—"}
              sub="open trades"
              size="sm"
            />
            <MetricTile
              label="Gaps"
              value={recon.gaps_found ?? "—"}
              sub="unmatched"
              tone={(recon.gaps_found ?? 0) > 0 ? "warn" : "neutral"}
              size="sm"
            />
          </div>

          <div className="text-caption text-fg-muted">
            Last reconcile{" "}
            <span className="font-mono text-fg-primary">
              {fmtAge(recon.last_reconcile_ago_seconds)}
            </span>
            {recon.last_reconcile_ts && (
              <span className="font-mono text-fg-faint">
                {" "}
                · {recon.last_reconcile_ts}
              </span>
            )}
          </div>

          {mismatches.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-micro uppercase tracking-wider text-fg-muted">
                Open mismatches:
              </span>
              {mismatches.map((m) => (
                <Pill key={m.kind} tone="amber" size="sm">
                  {plainMismatchKind(m.kind)} {m.count}
                </Pill>
              ))}
            </div>
          )}

          {(recon.queue_pending != null || recon.queue_escalated != null || recon.stuck) && (
            <div className="flex flex-wrap items-center gap-1.5 text-caption text-fg-muted">
              <span className="text-micro uppercase tracking-wider text-fg-muted">
                Queue:
              </span>
              <span className="font-mono text-fg-primary">
                {recon.queue_pending ?? 0} pending
              </span>
              <span className="font-mono text-fg-faint">·</span>
              <span className="font-mono text-fg-primary">
                {recon.queue_escalated ?? 0} escalated
              </span>
              {recon.stuck && (
                <Pill intent="error" size="sm">
                  STUCK · {fmtAge(recon.oldest_unresolved_age_seconds)}
                </Pill>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
