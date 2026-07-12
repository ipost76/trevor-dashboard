"use client";
import * as React from "react";
import { EmptyState, Skeleton, Pill } from "@/components/ui";
import { cn } from "@/lib/utils";

// PROMOTIONS subtab (RM-SHADOW-PROMOTE B2 · two-sided worklist B4) — Ghost's
// promote-or-cull glance list. Reads /api/shadow/promotions (→
// query_promotion_ready.py, replica mode=ro) which surfaces ONLY the rows B3's
// nightly gate flagged: READY (promote up) + REMOVE (cull out). The auto-stamped
// accruing in_progress flood is filtered at the source and never appears here.
// A manual in_progress shows in its own small group iff B3 surfaced it.
//
// READ-ONLY display — every state transition + the surfaced flag is B3's VM job.
// Empty until B3 surfaces a candidate → the friendly empty state is the proof
// the subtab is decoupled and safe.

type PromotionState = "ready" | "in_progress" | "removed";

interface Promotion {
  shadow_name: string;
  description: string | null;
  state: PromotionState;
  n_distinct: number | null;
  expectancy_usd: number | null;
  verdict_summary: string | null;
  first_ready_at: string | null;
  updated_at: string | null;
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

// Metric bits: n=X · ±$Y/trade (whichever are present).
function metricBits(p: Promotion): string[] {
  const bits: string[] = [];
  if (p.n_distinct !== null && p.n_distinct !== undefined) bits.push(`n=${p.n_distinct}`);
  const exp = fmtExpectancy(p.expectancy_usd);
  if (exp) bits.push(exp);
  return bits;
}

// REMOVE 'why' — B3 writes the reason into verdict_summary as
// "BLOCKED (loss|noise|dead): <detail>". Pull the tag + detail; degrade to the
// raw verdict_summary (or nothing) if the shape is unexpected — never invent.
function parseRemoveReason(vs: string | null): { tag: string | null; detail: string } {
  if (!vs) return { tag: null, detail: "" };
  const m = vs.match(/^\s*BLOCKED\s*\(([^)]+)\)\s*:?\s*(.*)$/i);
  if (m) return { tag: m[1].trim().toLowerCase(), detail: (m[2] || "").trim() };
  return { tag: null, detail: vs };
}

// loss = proven-negative (red) · noise = churn (gold) · dead + unknown → neutral.
function reasonIntent(tag: string | null): "error" | "warn" | undefined {
  if (tag === "loss") return "error";
  if (tag === "noise") return "warn";
  return undefined;
}

// A promote-side row (ready / manual in_progress): dot + name + desc + metrics.
function PromoteRow({ p }: { p: Promotion }) {
  const ready = p.state === "ready";
  const bits = metricBits(p);
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border px-3 py-2 transition-colors duration-fast",
        ready ? "border-accent-mint-strong/30 bg-bg-card" : "border-accent-gold/40 bg-bg-card",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-1 h-2 w-2 shrink-0 self-start rounded-pill",
          ready ? "bg-accent-mint-strong" : "bg-accent-gold",
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-sans font-semibold text-fg-primary text-caption">
          {p.shadow_name}
        </span>
        {p.description && (
          <span className="font-sans text-micro leading-relaxed text-fg-muted line-clamp-2">
            {p.description}
          </span>
        )}
        {bits.length > 0 && (
          <span className="font-mono text-micro text-fg-faint">{bits.join(" · ")}</span>
        )}
      </div>
      <span className="mt-0.5 shrink-0 self-start">
        {ready ? (
          <Pill intent="active" size="sm">READY</Pill>
        ) : (
          <Pill intent="warn" size="sm">IN PROGRESS</Pill>
        )}
      </span>
    </div>
  );
}

// A cull-side row: red framing + name + reason tag + desc + metrics + the WHY
// detail (from verdict_summary) so Ghost knows what he's culling.
function RemoveRow({ p }: { p: Promotion }) {
  const bits = metricBits(p);
  const { tag, detail } = parseRemoveReason(p.verdict_summary);
  const intent = reasonIntent(tag);
  return (
    <div className="flex items-start gap-3 rounded-md border border-accent-red/40 bg-bg-card px-3 py-2 transition-colors duration-fast">
      <span aria-hidden className="mt-1 h-2 w-2 shrink-0 rounded-pill bg-accent-red" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate font-sans font-semibold text-fg-primary text-caption">
            {p.shadow_name}
          </span>
          {tag &&
            (intent ? (
              <Pill intent={intent} size="sm">{tag}</Pill>
            ) : (
              <Pill tone="neutral" size="sm">{tag}</Pill>
            ))}
        </div>
        {p.description && (
          <span className="font-sans text-micro leading-relaxed text-fg-muted line-clamp-2">
            {p.description}
          </span>
        )}
        {bits.length > 0 && (
          <span className="font-mono text-micro text-fg-faint">{bits.join(" · ")}</span>
        )}
        {detail && (
          <span className="font-sans text-micro leading-relaxed text-accent-red/80 line-clamp-2">
            {detail}
          </span>
        )}
      </div>
      <span className="mt-0.5 shrink-0">
        <Pill intent="error" size="sm">REMOVE</Pill>
      </span>
    </div>
  );
}

// Section header: colored label + count pill.
function SectionHeader({
  label,
  count,
  intent,
  colorClass,
}: {
  label: string;
  count: number;
  intent: "active" | "warn" | "error";
  colorClass: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "font-sans text-caption font-semibold uppercase tracking-wider",
          colorClass,
        )}
      >
        {label}
      </span>
      <Pill intent={intent} size="sm">{count}</Pill>
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

  const ready = promotions.filter((p) => p.state === "ready");
  const inProgress = promotions.filter((p) => p.state === "in_progress");
  const removed = promotions.filter((p) => p.state === "removed");

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
          {ready.length} to promote · {removed.length} to remove
        </span>
      </div>

      {/* Honest framing: promote the ready, cull the removed. */}
      <p className="font-sans text-micro leading-relaxed text-fg-muted">
        Two-sided worklist — the shadows B3&apos;s nightly gate surfaced to promote
        or cull. Display only; every state change is the gate&apos;s job.
      </p>

      {loading && promotions.length === 0 ? (
        <Skeleton className="h-48 w-full" />
      ) : promotions.length === 0 ? (
        <EmptyState
          title="Nothing to promote, nothing to cull yet"
          body="The nightly gate hasn't surfaced any shadows to promote or remove."
        />
      ) : (
        <div className="space-y-6">
          {ready.length > 0 && (
            <section className="space-y-2">
              <SectionHeader
                label="Ready to promote"
                count={ready.length}
                intent="active"
                colorClass="text-accent-mint-strong"
              />
              <div className="space-y-1.5">
                {ready.map((p) => (
                  <PromoteRow key={p.shadow_name} p={p} />
                ))}
              </div>
            </section>
          )}

          {inProgress.length > 0 && (
            <section className="space-y-2">
              <SectionHeader
                label="In progress (manual)"
                count={inProgress.length}
                intent="warn"
                colorClass="text-accent-gold-strong"
              />
              <div className="space-y-1.5">
                {inProgress.map((p) => (
                  <PromoteRow key={p.shadow_name} p={p} />
                ))}
              </div>
            </section>
          )}

          {removed.length > 0 && (
            <section className="space-y-2">
              <SectionHeader
                label="Remove candidates"
                count={removed.length}
                intent="error"
                colorClass="text-accent-red"
              />
              <div className="space-y-1.5">
                {removed.map((p) => (
                  <RemoveRow key={p.shadow_name} p={p} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
