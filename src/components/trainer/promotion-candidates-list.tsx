"use client";
import * as React from "react";
import { EmptyState, Pill, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { APPROVAL_RECORDING_NOTE, ApproveRejectControl } from "./approve-reject-control";
import { PromotionsList } from "@/components/intel/promotions-list";
import { bitsWithDropped, plainAxis, plainMetric } from "@/lib/plain-labels";

// TRAINER · "promotions" sub-tab (R12-B1). The PRIMARY surface = R8's
// promotion_candidates (config diff + stats + reasoning) from
// /api/trainer/promotion-candidates, each with the record-only approve/reject
// control (H4). ABSENT until cutover → friendly <EmptyState>.
//
// 🚨 The LEGACY promotion_ready readiness gate is kept as a clearly-labelled
// SECONDARY section below (the existing <PromotionsList>) — never merged, never
// deleted. Two separate tables, two separate surfaces.

type Candidate = Record<string, unknown> & {
  candidate_id: string | null;
  shadow_id: string | null;
};
interface CandidatesResponse {
  status: "ok" | "no_data_yet";
  candidates: Candidate[];
  count: number;
  write_enabled: boolean;
  replica_age_seconds: number | null;
  error?: string;
}

function fmtReplicaAge(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "unknown";
  if (sec < 60) return `${Math.floor(sec)}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

// Pull the reasoning string from whichever key R8 lands it under (verdict_summary
// is the documented one). Never invent — return null if absent.
function reasoningOf(c: Candidate): string | null {
  for (const k of ["verdict_summary", "reasoning", "verdict"]) {
    const v = c[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

// Compact scalar stats (sample size / expectancy / net / win rate / …).
//
// 🚨 ALLOWLISTED, and that is the point. This helper used to be generic BY
// DESIGN — "every scalar column except the ids + reasoning, future-proof against
// R8's DDL" — which made it a standing guarantee that every column R8 ever adds
// ships its raw name to the screen. `promotion_candidates` does not exist yet, so
// that would have fired at cutover, on columns nobody has seen. Only keys with a
// plain-English label in plain-labels.ts render; everything else is counted and
// surfaced as "+N more", so the omission is visible rather than silent.
function statBits(c: Candidate): { bits: string[]; dropped: number } {
  const skip = new Set(["candidate_id", "shadow_id", "verdict_summary", "reasoning", "verdict"]);
  const bits: string[] = [];
  let dropped = 0;
  for (const [k, v] of Object.entries(c)) {
    if (skip.has(k)) continue;
    const label = plainMetric(k) ?? plainAxis(k);
    if (label === null) { dropped++; continue; }
    if (typeof v === "number") bits.push(`${label} ${Number.isInteger(v) ? v : v.toFixed(3)}`);
    else if (typeof v === "string" && v.length <= 24 && v.trim()) bits.push(`${label} ${v}`);
    else dropped++;
  }
  return { bits: bits.slice(0, 8), dropped: dropped + Math.max(0, bits.length - 8) };
}

function CandidateRow({ c, writeEnabled }: { c: Candidate; writeEnabled: boolean }) {
  const reasoning = reasoningOf(c);
  const stats = statBits(c);
  const bits = bitsWithDropped(stats.bits, stats.dropped);
  const candidateId = typeof c.candidate_id === "string" ? c.candidate_id : null;
  const shadowId = typeof c.shadow_id === "string" ? c.shadow_id : null;
  return (
    <div className="flex items-start gap-3 rounded-md border border-accent-mint-strong/30 bg-bg-card px-3 py-2">
      <span aria-hidden className="mt-1 h-2 w-2 shrink-0 rounded-pill bg-accent-mint-strong" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-sans font-semibold text-fg-primary text-caption">
          {shadowId ?? candidateId ?? "candidate"}
        </span>
        {reasoning && (
          <span className="font-sans text-micro leading-relaxed text-fg-muted line-clamp-3">
            {reasoning}
          </span>
        )}
        {bits.length > 0 && (
          <span className="font-mono text-micro text-fg-faint">{bits.join(" · ")}</span>
        )}
      </div>
      <ApproveRejectControl candidateId={candidateId} writeEnabled={writeEnabled} />
    </div>
  );
}

export function PromotionCandidatesList() {
  const [data, setData] = React.useState<CandidatesResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/trainer/promotion-candidates", { cache: "no-store" });
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

  const candidates = data?.candidates ?? [];
  const writeEnabled = data?.write_enabled ?? false;
  const replicaAge = data?.replica_age_seconds ?? null;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        {/* Replica freshness + write-state — never imply real-time. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-micro text-fg-muted">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-1.5 w-1.5 rounded-pill bg-accent-cyan-soft" />
            Read {fmtReplicaAge(replicaAge)} ago · updates about every 15 minutes
          </span>
          <span className="text-fg-faint">·</span>
          <span>{candidates.length} candidates</span>
          {!writeEnabled && (
            <Pill tone="neutral" size="sm" title={APPROVAL_RECORDING_NOTE}>
              read-only
            </Pill>
          )}
        </div>

        <p className="font-sans text-micro leading-relaxed text-fg-muted">
          Changes the trainer has proposed, for a one-glance decision.{" "}
          {APPROVAL_RECORDING_NOTE}
        </p>

        {loading && data === null ? (
          <Skeleton className="h-40 w-full" />
        ) : candidates.length === 0 ? (
          <EmptyState
            title="No promotion candidates yet"
            body="The trainer hasn't proposed a change yet."
          />
        ) : (
          <div className="space-y-1.5">
            {candidates.map((c, i) => (
              <CandidateRow
                key={(typeof c.candidate_id === "string" ? c.candidate_id : null) ?? i}
                c={c}
                writeEnabled={writeEnabled}
              />
            ))}
          </div>
        )}
      </section>

      {/* SECONDARY — the legacy readiness gate (promotion_ready). A SEPARATE
          table + surface; never merged with promotion_candidates. */}
      <section className="space-y-2">
        <div className={cn("flex items-center gap-2 border-t border-border-subtle pt-4")}>
          <span className="font-sans text-caption font-semibold uppercase tracking-wider text-fg-muted">
            Readiness gate (secondary)
          </span>
          <Pill tone="neutral" size="sm">Legacy</Pill>
        </div>
        <p className="font-sans text-micro leading-relaxed text-fg-muted">
          The nightly readiness-gate worklist — a separate view from the candidates
          above (different table). Kept for reference; not the approve surface.
        </p>
        <PromotionsList />
      </section>
    </div>
  );
}
