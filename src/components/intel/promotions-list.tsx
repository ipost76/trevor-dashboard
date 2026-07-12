"use client";
import * as React from "react";
import { EmptyState, Skeleton, Pill } from "@/components/ui";
import { cn } from "@/lib/utils";

// PROMOTIONS subtab (RM-SHADOW-PROMOTE B2) — the at-a-glance readiness tracker
// Ghost asked for: which shadows the nightly gate flagged, without a full CC
// recon. Reads /api/shadow/promotions (→ query_promotion_ready.py, replica
// mode=ro). Simple glance list — name + short description + a READY/IN PROGRESS
// state badge + the n / expectancy metrics in small text. No deep stats, no
// recon. READ-ONLY display — every state transition is B1's nightly job.
//
// The table is EMPTY until B1's off-loop VM gate populates it, so the empty
// state ("Nothing ready yet…") is the primary render today — the proof the
// subtab is decoupled and safe.

type PromotionState = "ready" | "in_progress";

interface Promotion {
  shadow_name: string;
  description: string | null;
  state: PromotionState;
  n_distinct: number | null;
  expectancy_usd: number | null;
  verdict_summary: string | null;
  first_ready_at: string | null;
}

interface PromotionsResponse {
  promotions: Promotion[];
  total: number;
  replica_age_seconds: number | null;
  error?: string;
}

function fmtReplicaAge(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "unknown";
  if (sec < 60) return `${Math.floor(sec)}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

function fmtExpectancy(v: number | null | undefined): string | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(v).toFixed(3)}/trade`;
}

// One glance row: dot + name + short description + n/expectancy + state badge.
function PromotionRow({ p }: { p: Promotion }) {
  const ready = p.state === "ready";
  const dot = ready ? "bg-accent-mint-strong" : "bg-accent-gold";
  const badge = ready ? (
    <Pill intent="active" size="sm">READY</Pill>
  ) : (
    <Pill intent="warn" size="sm">IN PROGRESS</Pill>
  );

  const metricBits: string[] = [];
  if (p.n_distinct !== null && p.n_distinct !== undefined) metricBits.push(`n=${p.n_distinct}`);
  const exp = fmtExpectancy(p.expectancy_usd);
  if (exp) metricBits.push(exp);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border px-3 py-2 transition-colors duration-fast",
        ready ? "border-accent-mint-strong/30 bg-bg-card" : "border-accent-gold/40 bg-bg-card",
      )}
    >
      <span aria-hidden className={cn("mt-1 h-2 w-2 shrink-0 self-start rounded-pill", dot)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-sans font-semibold text-fg-primary text-caption">
          {p.shadow_name}
        </span>
        {p.description && (
          <span className="font-sans text-micro leading-relaxed text-fg-muted line-clamp-2">
            {p.description}
          </span>
        )}
        {metricBits.length > 0 && (
          <span className="font-mono text-micro text-fg-faint">{metricBits.join(" · ")}</span>
        )}
      </div>
      <span className="mt-0.5 shrink-0 self-start">{badge}</span>
    </div>
  );
}

export function PromotionsList() {
  const [data, setData] = React.useState<PromotionsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/shadow/promotions", { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) setData(await res.json());
      } catch {
        // network errors swallow; keep last-good snapshot
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

  const promotions = data?.promotions ?? [];
  const replicaAge = data?.replica_age_seconds ?? null;
  const readyCount = promotions.filter((p) => p.state === "ready").length;
  const inProgressCount = promotions.length - readyCount;

  if (data?.error) {
    return (
      <div className="p-4 md:p-6 lg:px-8">
        <EmptyState title="Couldn't load" body={data.error} />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      {/* Replica freshness — the WSL litestream replica refreshes every ~15 min. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-micro text-fg-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-1.5 w-1.5 rounded-pill bg-accent-cyan-soft" />
          replica {fmtReplicaAge(replicaAge)} · refreshes ~15 min
        </span>
        <span className="text-fg-faint">·</span>
        <span>
          {readyCount} ready · {inProgressCount} in progress
        </span>
      </div>

      {/* Honest framing: this is the readiness tracker, not a promote button. */}
      <p className="font-sans text-micro leading-relaxed text-fg-muted">
        Shadows the nightly readiness gate has flagged. Display only — nothing here
        is live yet.
      </p>

      {loading && promotions.length === 0 ? (
        <Skeleton className="h-48 w-full" />
      ) : promotions.length === 0 ? (
        <EmptyState
          title="Nothing ready yet"
          body="The nightly gate hasn't flagged any shadows for promotion."
        />
      ) : (
        <div className="space-y-1.5">
          {promotions.map((p) => (
            <PromotionRow key={p.shadow_name} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}
