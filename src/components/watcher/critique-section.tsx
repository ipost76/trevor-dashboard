"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, Pill, EmptyState, Skeleton } from "@/components/ui";
import { fmtAge, fmtUpdated } from "./watcher-format";

/**
 * WATCHER → critique sub-tab. The trainer decisions the watcher reviewed and
 * flagged as PROBLEMS (watcher_critiques, data/watcher.db mode=ro via
 * /api/watcher/critiques).
 *
 * The watcher critiques ONLY problems — a clean decision produces NO row. So an
 * empty list means "nothing wrong found", NOT "nothing checked". This is the
 * watcher's Hub-only teaching channel: Ghost reads it and adjusts the trainer
 * via CC. Pre-cutover the trainer hasn't decided anything, so this is empty by
 * design.
 */

interface FiredCheck {
  check: string;
  evidence: string;
}
interface Critique {
  id: number;
  decision_ref: string;
  decision_kind: string;
  level_id: number;
  severity: "note" | "concern" | "problem" | string;
  fired_checks: FiredCheck[];
  checks_applicable: number;
  judgment_text: string | null;
  llm_used: boolean;
  ts: string;
}
interface Resp {
  status: string;
  critiques: Critique[];
  updated_seconds: number | null;
  error?: string;
}

function severityIntent(sev: string): "error" | "warn" | undefined {
  if (sev === "problem") return "error";
  if (sev === "concern") return "warn";
  return undefined; // note -> neutral tone
}

export function CritiqueSection() {
  const [data, setData] = React.useState<Resp | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/watcher/critiques", { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) setData(await res.json());
      } catch {
        // swallow — keep last-good.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading && !data) {
    return (
      <div className="space-y-4 p-4 md:p-6 lg:px-8">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!data || data.error) {
    return (
      <div className="p-4 md:p-6 lg:px-8">
        <EmptyState
          title="Critiques unavailable"
          body={
            data?.error
              ? `Couldn't read the watcher's critique store right now: ${data.error}`
              : "Couldn't read the watcher's critique store right now."
          }
        />
      </div>
    );
  }

  const critiques = data.critiques ?? [];

  if (critiques.length === 0) {
    return (
      <div className="space-y-4 p-4 md:p-6 lg:px-8 animate-fade-in">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-micro text-fg-muted">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-1.5 w-1.5 rounded-pill bg-accent-mint-strong" />
            {fmtUpdated(data.updated_seconds)}
          </span>
        </div>
        <EmptyState
          title="Nothing wrong found"
          body="The watcher critiques only problems — an empty list means no problem was flagged, not that nothing was checked. Pre-cutover the trainer hasn't decided anything yet."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-micro text-fg-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-1.5 w-1.5 rounded-pill bg-accent-gold" />
          {fmtUpdated(data.updated_seconds)}
        </span>
        <span className="text-fg-faint">·</span>
        <span>
          {critiques.length} problem{critiques.length === 1 ? "" : "s"} the watcher
          flagged — read + adjust the trainer via CC
        </span>
      </div>

      <div className="space-y-3">
        {critiques.map((c) => (
          <Card key={c.id} className={c.severity === "problem" ? "card-warn" : undefined}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Pill intent={severityIntent(c.severity)} tone={severityIntent(c.severity) ? undefined : "neutral"} size="sm">
                  {c.severity}
                </Pill>
                <CardTitle>
                  {c.decision_kind} · {c.decision_ref}
                </CardTitle>
                <span className="font-sans text-micro text-fg-faint">level {c.level_id}</span>
                <span className="ml-auto font-sans text-micro text-fg-faint">
                  {fmtAge(c.ts)} ago
                </span>
              </div>
            </CardHeader>
            <div className="space-y-2 p-3 md:p-4">
              {/* Mechanical findings — the deterministic checks that DECIDED this
                  surfaced. The R11 memory hook is never shown (that's R11). */}
              <div className="space-y-1">
                <div className="font-sans text-micro uppercase tracking-wider text-fg-muted">
                  what fired ({c.fired_checks.length} of {c.checks_applicable} checks)
                </div>
                {c.fired_checks.length === 0 ? (
                  <p className="font-sans text-micro text-fg-faint">no mechanical check recorded</p>
                ) : (
                  c.fired_checks.map((f, i) => (
                    <div key={i} className="font-mono text-micro text-fg-primary">
                      <span className="text-accent-gold">{f.check}</span>
                      {f.evidence ? <span className="text-fg-muted"> — {f.evidence}</span> : null}
                    </div>
                  ))
                )}
              </div>
              {/* Judgment prose — LLM (or template when budget-exhausted). Text
                  only; it can never flip a mechanical finding. */}
              {c.judgment_text && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-sans text-micro uppercase tracking-wider text-fg-muted">
                      judgment
                    </span>
                    <Pill tone="neutral" size="sm">
                      {c.llm_used ? "llm" : "template"}
                    </Pill>
                  </div>
                  <p className="font-sans text-caption leading-relaxed text-fg-primary">
                    {c.judgment_text}
                  </p>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
