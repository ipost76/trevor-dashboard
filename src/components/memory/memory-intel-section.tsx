"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, Pill, EmptyState, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Memory & Intelligence — the single-view /memory zone (RM-HUB-INTEL B2).
 *
 * Replaced the old 4 raw MEMORY sub-tabs (brain / memory / chromadb /
 * aggressive) with one quick-glance dashboard: "is the brain learning, what's
 * unlocked, what's ready" — read from the `loop_health` table via
 * /api/memory/intel (query_loop_health.py, replica mode=ro).
 *
 * GLANCE-ONLY (per RM-HUB-INTEL master §4.2). Deep Gate-2 statistics live on
 * the Health page; shadow-table inventory lives on Intel → Shadow; the raw
 * evidence_json is parsed to a summary server-side and never rendered here.
 * READ-ONLY display: fetch-on-mount, no writes, no controls, no flag flips.
 */

interface LoopHealth {
  loop_name: string;
  stage: "shadow" | "probation" | "live";
  verdict: "RED" | "GREEN" | "YELLOW";
  verdict_reason: string;
  pass_streak: number | null;
  summary: string;
  updated_at: string | null;
}

interface C1bCard {
  present: boolean;
  loop_name: string;
  verdict: string;
  n_obs: number | null;
  n_bar: number | null;
  count_met: boolean;
  span_days: number | null;
  span_bar: number | null;
  time_met: boolean;
  criteria: Record<string, boolean>;
  criteria_met: number;
  criteria_total: number;
  ready_for_review: boolean;
  note: string | null;
}

interface MemoryIntelResponse {
  loops: LoopHealth[];
  stage_counts: Record<string, number>;
  verdict_counts: Record<string, number>;
  total: number;
  c1b: C1bCard | null;
  replica_age_seconds: number | null;
  replica_mtime: string | null;
  error?: string;
}

const VERDICT_DOT: Record<string, string> = {
  GREEN: "bg-accent-mint-strong",
  RED: "bg-accent-red",
  YELLOW: "bg-accent-amber",
};

const STAGE_TONE: Record<string, "green" | "amber" | "cyan"> = {
  live: "green",
  probation: "amber",
  shadow: "cyan",
};

function fmtAge(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 90) return `${sec}s ago`;
  const m = Math.round(sec / 60);
  if (m < 90) return `${m}m ago`;
  const h = sec / 3600;
  return `${h.toFixed(1)}h ago`;
}

// ── one status row per loop ──────────────────────────────────────────────────
function LoopRow({ loop }: { loop: LoopHealth }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border-subtle bg-bg-card px-3 py-2.5">
      <span
        aria-hidden
        className={cn(
          "mt-1 h-2 w-2 shrink-0 self-start rounded-pill",
          VERDICT_DOT[loop.verdict] ?? "bg-fg-faint",
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-mono text-caption font-semibold text-fg-primary">
          {loop.loop_name}
        </span>
        <span className="text-micro text-fg-muted">{loop.summary}</span>
      </div>
      <Pill tone={STAGE_TONE[loop.stage] ?? "neutral"} size="sm">
        {loop.stage}
      </Pill>
    </div>
  );
}

// ── C1b dual-axis readiness card ─────────────────────────────────────────────
function AxisBar({
  label,
  cur,
  bar,
  met,
}: {
  label: string;
  cur: number | null;
  bar: number | null;
  met: boolean;
}) {
  const pct =
    cur != null && bar != null && bar > 0
      ? Math.min(100, Math.round((cur / bar) * 100))
      : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-micro">
        <span className="text-fg-muted uppercase tracking-wider">{label}</span>
        <span className="font-mono tabular-nums text-fg-primary">
          {cur ?? "—"}
          <span className="text-fg-dim"> / {bar ?? "—"}</span>
          <span className={cn("ml-2", met ? "text-accent-mint-strong" : "text-accent-amber")}>
            {met ? "met ✓" : "accruing"}
          </span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-pill bg-bg-elevated">
        <div
          className={cn("h-full rounded-pill", met ? "bg-accent-mint-strong" : "bg-accent-cyan-soft")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function C1bReadiness({ c1b }: { c1b: C1bCard }) {
  return (
    <Card padding="sm" className="border-border-strong">
      <CardHeader>
        <CardTitle>C1b Feature-Fix · Readiness</CardTitle>
        <Pill intent={c1b.ready_for_review ? "active" : "warn"} size="sm">
          {c1b.ready_for_review ? "ready for review" : "accruing"}
        </Pill>
      </CardHeader>

      <div className="flex flex-col gap-3">
        <AxisBar label="observations" cur={c1b.n_obs} bar={c1b.n_bar} met={c1b.count_met} />
        <AxisBar label="span (days)" cur={c1b.span_days} bar={c1b.span_bar} met={c1b.time_met} />

        <div className="flex flex-col gap-1 border-t border-border-subtle pt-2.5">
          <span className="text-micro uppercase tracking-wider text-fg-muted">
            criteria · {c1b.criteria_met}/{c1b.criteria_total}
          </span>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {Object.entries(c1b.criteria).map(([name, ok]) => (
              <span key={name} className="flex items-center gap-1.5 text-micro">
                <span className={ok ? "text-accent-mint-strong" : "text-accent-amber"}>
                  {ok ? "✓" : "○"}
                </span>
                <span className="font-mono text-fg-muted">{name}</span>
              </span>
            ))}
          </div>
        </div>

        {c1b.note && (
          <p className="text-micro leading-relaxed text-fg-dim">{c1b.note}</p>
        )}
      </div>
    </Card>
  );
}

// ── header rollup ────────────────────────────────────────────────────────────
function Rollup({ data }: { data: MemoryIntelResponse }) {
  const s = data.stage_counts;
  const v = data.verdict_counts;
  return (
    <Card padding="sm">
      <CardHeader>
        <CardTitle>Memory &amp; Intelligence</CardTitle>
        <span className="text-micro text-fg-muted">updated {fmtAge(data.replica_age_seconds)}</span>
      </CardHeader>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="text-h2 font-bold tabular-nums text-fg-primary">
          {data.total}
          <span className="ml-1.5 text-caption font-normal text-fg-muted">loops</span>
        </span>
        <span className="h-6 w-px bg-border-subtle" />
        <div className="flex flex-wrap items-center gap-2">
          {(["live", "probation", "shadow"] as const).map((stage) =>
            s[stage] ? (
              <Pill key={stage} tone={STAGE_TONE[stage]} size="sm">
                {s[stage]} {stage}
              </Pill>
            ) : null,
          )}
        </div>
        <span className="h-6 w-px bg-border-subtle" />
        <div className="flex flex-wrap items-center gap-3 text-caption">
          {(["GREEN", "YELLOW", "RED"] as const).map((verdict) =>
            v[verdict] ? (
              <span key={verdict} className="flex items-center gap-1.5">
                <span aria-hidden className={cn("h-2 w-2 rounded-pill", VERDICT_DOT[verdict])} />
                <span className="tabular-nums text-fg-primary">{v[verdict]}</span>
              </span>
            ) : null,
          )}
        </div>
      </div>
    </Card>
  );
}

export function MemoryIntelSection() {
  const [data, setData] = React.useState<MemoryIntelResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/memory/intel", { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) setData(await res.json());
      } catch {
        // swallow — keep last-good; the error branch below covers a null fetch
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading && !data) {
    return (
      <div className="space-y-4 p-4 md:p-6 lg:px-8">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!data || data.error || data.total === 0) {
    return (
      <div className="p-4 md:p-6 lg:px-8">
        <EmptyState
          title={data?.error ? "Loop health unavailable" : "No learning loops registered"}
          body={
            data?.error
              ? `Could not read loop_health: ${data.error}`
              : "The loop_health table has no rows yet — the brain has no active learning loops to report."
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <Rollup data={data} />

      {data.c1b?.present && <C1bReadiness c1b={data.c1b} />}

      <section className="space-y-1.5">
        <h3 className="px-0.5 text-micro uppercase tracking-wider text-fg-muted">
          Loops ({data.loops.length})
        </h3>
        <div className="space-y-1.5">
          {data.loops.map((loop) => (
            <LoopRow key={loop.loop_name} loop={loop} />
          ))}
        </div>
      </section>
    </div>
  );
}
