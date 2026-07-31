"use client";
import * as React from "react";
import { EmptyState, Pill, Skeleton } from "@/components/ui";
import { bitsWithDropped, plainAxis, plainMetric } from "@/lib/plain-labels";

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

// Compact scalar fields (requested axes / reason / …) except the ids + status.
//
// 🚨 ALLOWLISTED. This was generic BY DESIGN — "future-proof against the loop's
// DDL" — which is not future-proofing, it is a standing promise to print every
// column the loop ever invents. `capability_requests` is created lazily at
// cutover, so the raw names would have appeared on a surface nobody had seen.
// Array values are glossed per-element too: an axis list is a list of
// identifiers, and half of them ("timing_context") are not English words.
function detailBits(r: CapabilityRequest): { bits: string[]; dropped: number } {
  const skip = new Set(["shadow_id", "status"]);
  const bits: string[] = [];
  let dropped = 0;
  for (const [k, v] of Object.entries(r)) {
    if (skip.has(k)) continue;
    const label = plainAxis(k) ?? plainMetric(k);
    if (label === null) { dropped++; continue; }
    if (typeof v === "number") bits.push(`${label} ${v}`);
    else if (typeof v === "string" && v.trim()) {
      bits.push(`${label} ${v.length > 40 ? v.slice(0, 40) + "…" : v}`);
    } else if (Array.isArray(v)) {
      const named = v.map((x) => plainAxis(String(x))).filter((x): x is string => x !== null);
      dropped += v.length - named.length;
      if (named.length > 0) bits.push(`${label}: ${named.join(", ").slice(0, 60)}`);
    } else dropped++;
  }
  return { bits: bits.slice(0, 6), dropped: dropped + Math.max(0, bits.length - 6) };
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
            const detail = detailBits(r);
            const bits = bitsWithDropped(detail.bits, detail.dropped);
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
