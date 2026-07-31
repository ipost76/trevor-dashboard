"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, EmptyState, Pill, Skeleton } from "@/components/ui";
import { plainAxis, plainStatus } from "@/lib/plain-labels";

// TRAINER · "search" sub-tab. The trainer's config-space search state from
// /api/trainer/search (trainer.db): the settings it is testing, the standing
// ideas, and how it scores them. READ-ONLY display.
// Pre-cutover EMPTY is the display, not an error — 0 settings + 0 ideas render
// a friendly <EmptyState>; the scoring weights show as a small footer.
//
// 🚨 NO HASH REACHES THE SCREEN. Rows used to be titled with a truncated
// arm_hash, which identifies a setting to the database and to nobody else; they
// are titled by what the setting varies instead.

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

function num(v: number | null | undefined, d = 3): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toFixed(d);
}

/** A 0–1 rate as a whole percentage. */
function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

// F1: titleCase() is gone. It looked like a gloss but only capitalised an
// identifier, which is the subtler half of this defect class — every caller now
// goes through the plain-labels allowlists instead.

// A row title must say what the setting VARIES, never identify it by hash — a
// hash is meaningless on screen. Falls back to a plain ordinal.
function armTitle(axes: unknown, index: number): string {
  let parsed: unknown = axes;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      /* not JSON — fall through to the ordinal */
    }
  }
  if (parsed && typeof parsed === "object") {
    // 🚨 F1: ALLOWLISTED. These are config-axis identifiers; titleCase() only
    // capitalised them, so "timing_context" reached the screen as "Timing
    // context". An axis with no plain-English label is counted, never named.
    const keys = Object.keys(parsed as Record<string, unknown>).filter(Boolean);
    const named = keys
      .map((k) => plainAxis(k))
      .filter((x): x is string => x !== null);
    const dropped = keys.length - named.length;
    if (named.length > 0) {
      return dropped > 0
        ? `${named.join(" · ")} · +${dropped} more`
        : named.join(" · ");
    }
  }
  return `Setting ${index + 1}`;
}

function CompassCard({ c }: { c: Compass }) {
  return (
    <Card className="card-base">
      <CardHeader>
        <CardTitle>How the trainer scores a setting</CardTitle>
      </CardHeader>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-4 pb-4 font-sans text-caption text-fg-muted sm:grid-cols-4">
        <div>
          Consistency<br />
          <span className="font-mono text-fg-primary">{num(c.w_consistency, 2)}</span>
        </div>
        <div>
          Size of the edge<br />
          <span className="font-mono text-fg-primary">{num(c.w_magnitude, 2)}</span>
        </div>
        <div>
          Worst drawdown allowed<br />
          <span className="font-mono text-fg-primary">{num(c.dd_ceiling, 2)}</span>
        </div>
        <div>
          Worst-case loss floor<br />
          <span className="font-mono text-fg-primary">{num(c.cvar_floor, 2)}</span>
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
        What the trainer is testing right now: the settings it likes best, the ideas
        it&apos;s still gathering evidence on, and how it scores them.
      </p>

      {empty ? (
        <EmptyState
          title="No trainer search yet"
          body="The trainer hasn't tried any settings yet. This fills in once it starts searching."
        />
      ) : (
        <>
          {arms.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="font-sans text-micro uppercase tracking-wider text-fg-muted">
                Settings being tested ({arms.length})
              </h3>
              {arms.map((a, i) => (
                <div
                  key={a.arm_hash ?? i}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border-subtle bg-bg-card px-3 py-2"
                >
                  <span className="font-sans text-caption text-fg-primary">
                    {armTitle(a.axes, i)}
                  </span>
                  <span className="text-fg-faint">·</span>
                  <span className="font-sans text-micro text-fg-muted">
                    Winning <span className="font-mono">{pct(a.mean)}</span> of the time ·
                    tried <span className="font-mono">{a.n_obs ?? 0}</span>{" "}
                    {(a.n_obs ?? 0) === 1 ? "time" : "times"}
                  </span>
                  {a.level_id !== null && (
                    <Pill tone="neutral" size="sm">Level {a.level_id}</Pill>
                  )}
                </div>
              ))}
            </section>
          )}

          {hypotheses.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="font-sans text-micro uppercase tracking-wider text-fg-muted">
                Ideas being tested ({hypotheses.length})
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
                    {h.status && (
                      <Pill tone="neutral" size="sm">{plainStatus(h.status)}</Pill>
                    )}
                  </div>
                  <span className="font-sans text-micro text-fg-faint">
                    {h.domain ? (plainAxis(h.domain) ?? "Other area") : "—"} ·{" "}
                    <span className="font-mono">{h.n_obs ?? 0}</span>{" "}
                    {(h.n_obs ?? 0) === 1 ? "observation" : "observations"}
                    {h.level_id !== null ? ` · Level ${h.level_id}` : ""}
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
