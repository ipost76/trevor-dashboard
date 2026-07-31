"use client";
import * as React from "react";
import { EmptyState, Pill, Skeleton } from "@/components/ui";

// TRAINER · "capability" sub-tab (R12-B1 · H8). The capability-request queue the
// R9 trainer routes to Ghost, from /api/trainer/capability-queue
// (capability_requests, replica). Framed as: "the loop routed a request; Ghost
// turns it into a CC prompt." ABSENT until cutover → friendly <EmptyState>.
//
// 🚨 READ-ONLY — a CC prompt services the queue; the Hub NEVER writes here.

type CapabilityRequest = Record<string, unknown> & {
  shadow_id: string | null;
  status: string | null;
};
interface CapabilityResponse {
  status: "ok" | "no_data_yet";
  requests: CapabilityRequest[];
  count: number;
  replica_age_seconds: number | null;
  error?: string;
}

function fmtReplicaAge(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "unknown";
  if (sec < 60) return `${Math.floor(sec)}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

// Compact scalar fields (requested axes / reason / …) except the ids + status,
// future-proof against the loop's DDL.
function detailBits(r: CapabilityRequest): string[] {
  const skip = new Set(["shadow_id", "status"]);
  const bits: string[] = [];
  for (const [k, v] of Object.entries(r)) {
    if (skip.has(k)) continue;
    if (typeof v === "number") bits.push(`${k}=${v}`);
    else if (typeof v === "string" && v.trim()) bits.push(`${k}=${v.length > 40 ? v.slice(0, 40) + "…" : v}`);
    else if (Array.isArray(v)) bits.push(`${k}=[${v.map(String).join(", ").slice(0, 60)}]`);
  }
  return bits.slice(0, 6);
}

export function CapabilityQueueSection() {
  const [data, setData] = React.useState<CapabilityResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/trainer/capability-queue", { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) setData(await res.json());
      } catch {
        /* keep last-good */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const requests = data?.requests ?? [];
  const replicaAge = data?.replica_age_seconds ?? null;

  if (loading && data === null) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-micro text-fg-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-1.5 w-1.5 rounded-pill bg-accent-cyan-soft" />
          Read {fmtReplicaAge(replicaAge)} ago · updates about every 15 minutes
        </span>
        <span className="text-fg-faint">·</span>
        <span>{requests.length} requests</span>
      </div>

      <p className="font-sans text-micro leading-relaxed text-fg-muted">
        Things the trainer has asked for that it can&apos;t do on its own. This is a
        list to read — nothing here is acted on from this page.
      </p>

      {requests.length === 0 ? (
        <EmptyState
          title="No capability requests"
          body="The trainer hasn't asked for anything new yet."
        />
      ) : (
        <div className="space-y-1.5">
          {requests.map((r, i) => {
            const bits = detailBits(r);
            const shadowId = typeof r.shadow_id === "string" ? r.shadow_id : null;
            const status = typeof r.status === "string" ? r.status : null;
            return (
              <div
                key={shadowId ?? i}
                className="flex flex-col gap-0.5 rounded-md border border-border-subtle bg-bg-card px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-sans font-semibold text-fg-primary text-caption">
                    {shadowId ?? "request"}
                  </span>
                  {status && <Pill tone="neutral" size="sm">{status}</Pill>}
                </div>
                {bits.length > 0 && (
                  <span className="font-mono text-micro text-fg-faint">{bits.join(" · ")}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
