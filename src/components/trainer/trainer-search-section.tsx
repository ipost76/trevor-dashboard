"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, EmptyState, Pill, Skeleton } from "@/components/ui";

// TRAINER · "search" sub-tab (R12-B1). The R9 trainer's config-space search
// state from /api/trainer/search (trainer.db): the bandit's per-arm posteriors,
// the standing hypotheses, and the current compass weights. READ-ONLY display.
// Pre-cutover EMPTY is the display, not an error — 0 arms + 0 hypotheses render
// a friendly <EmptyState>; the compass (seed) shows as a small footer.

interface Arm {
  arm_hash: string | null;
  level_id: number | null;
  axes: unknown;
  alpha: number | null;
  beta: number | null;
  n_obs: number | null;
  mean: number | null;
  last_sampled_at: string | null;
}
interface Hypothesis {
  hypothesis_id: string | number | null;
  level_id: number | null;
  domain: string | null;
  claim: string | null;
  n_obs: number | null;
  status: string | null;
  last_updated: string | null;
}
interface Compass {
  level_id: number | null;
  w_consistency: number | null;
  w_magnitude: number | null;
  dd_ceiling: number | null;
  cvar_floor: number | null;
  learned: number | null;
}
interface SearchResponse {
  status: "ok" | "no_data_yet";
  arms: Arm[];
  hypotheses: Hypothesis[];
  compass: Compass | null;
  counts: { arms: number; hypotheses: number };
  error?: string;
}

function short(h: string | null): string {
  if (!h) return "—";
  return h.length > 12 ? `${h.slice(0, 12)}…` : h;
}
function num(v: number | null | undefined, d = 3): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toFixed(d);
}

function CompassCard({ c }: { c: Compass }) {
  return (
    <Card className="card-base">
      <CardHeader>
        <CardTitle>Compass weights (current)</CardTitle>
      </CardHeader>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-4 pb-4 font-mono text-caption text-fg-muted sm:grid-cols-4">
        <div>
          consistency<br />
          <span className="text-fg-primary">{num(c.w_consistency, 2)}</span>
        </div>
        <div>
          magnitude<br />
          <span className="text-fg-primary">{num(c.w_magnitude, 2)}</span>
        </div>
        <div>
          dd ceiling<br />
          <span className="text-fg-primary">{num(c.dd_ceiling, 2)}</span>
        </div>
        <div>
          cvar floor<br />
          <span className="text-fg-primary">{num(c.cvar_floor, 2)}</span>
        </div>
      </div>
    </Card>
  );
}

export function TrainerSearchSection() {
  const [data, setData] = React.useState<SearchResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/trainer/search", { cache: "no-store" });
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

  const arms = data?.arms ?? [];
  const hypotheses = data?.hypotheses ?? [];
  const compass = data?.compass ?? null;
  const empty = arms.length === 0 && hypotheses.length === 0;

  if (loading && data === null) {
    return <Skeleton className="h-48 w-full" />;
  }

  return (
    <div className="space-y-4">
      <p className="font-sans text-micro leading-relaxed text-fg-muted">
        What the trainer is searching — the bandit&apos;s favoured arms, the standing
        hypotheses it&apos;s gathering evidence on, and the compass weights that score them.
      </p>

      {empty ? (
        <EmptyState
          title="No trainer search yet"
          body="The bandit hasn't sampled an arm — this lights up when the search loop starts."
        />
      ) : (
        <>
          {arms.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="font-sans text-micro uppercase tracking-wider text-fg-muted">
                Arms ({arms.length})
              </h3>
              {arms.map((a, i) => (
                <div
                  key={a.arm_hash ?? i}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border-subtle bg-bg-card px-3 py-2"
                >
                  <span className="font-mono text-caption text-fg-primary">{short(a.arm_hash)}</span>
                  <span className="text-fg-faint">·</span>
                  <span className="font-mono text-micro text-fg-muted">
                    mean {num(a.mean)} · α{num(a.alpha, 1)}/β{num(a.beta, 1)} · n={a.n_obs ?? 0}
                  </span>
                  {a.level_id !== null && (
                    <Pill tone="neutral" size="sm">L{a.level_id}</Pill>
                  )}
                </div>
              ))}
            </section>
          )}

          {hypotheses.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="font-sans text-micro uppercase tracking-wider text-fg-muted">
                Standing hypotheses ({hypotheses.length})
              </h3>
              {hypotheses.map((h, i) => (
                <div
                  key={h.hypothesis_id ?? i}
                  className="flex flex-col gap-0.5 rounded-md border border-border-subtle bg-bg-card px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-sans text-caption text-fg-primary line-clamp-2">
                      {h.claim ?? "—"}
                    </span>
                    {h.status && <Pill tone="neutral" size="sm">{h.status}</Pill>}
                  </div>
                  <span className="font-mono text-micro text-fg-faint">
                    {h.domain ?? "—"} · n={h.n_obs ?? 0}
                    {h.level_id !== null ? ` · L${h.level_id}` : ""}
                  </span>
                </div>
              ))}
            </section>
          )}
        </>
      )}

      {compass && <CompassCard c={compass} />}
    </div>
  );
}
