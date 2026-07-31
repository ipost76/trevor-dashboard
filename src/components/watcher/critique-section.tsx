"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, Pill, EmptyState, Skeleton } from "@/components/ui";
import { plainCheck, plainDecisionKind, plainSeverity } from "@/lib/plain-labels";
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

const JUDGMENT_MAX = 400;

/** Cut long prose at a real sentence end, never mid-word or mid-sentence. */
function truncateToSentence(text: string): string {
  const t = text.trim();
  if (t.length <= JUDGMENT_MAX) return t;
  const head = t.slice(0, JUDGMENT_MAX);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (end > 0) return head.slice(0, end + 1);
  const space = head.lastIndexOf(" ");
  return (space > 0 ? head.slice(0, space) : head) + "…";
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
          body="Couldn't read the watcher's records right now."
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
          body="Nothing wrong found. The watcher only records problems, so an empty list means it checked and found nothing."
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
          flagged while reviewing the bot&apos;s own learning decisions
        </span>
      </div>

      <div className="space-y-3">
        {critiques.map((c) => (
          <Card key={c.id} className={c.severity === "problem" ? "card-warn" : undefined}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Pill intent={severityIntent(c.severity)} tone={severityIntent(c.severity) ? undefined : "neutral"} size="sm">
                  {plainSeverity(c.severity)}
                </Pill>
                <CardTitle>{plainDecisionKind(c.decision_kind)}</CardTitle>
                <span className="font-sans text-micro text-fg-faint">Level {c.level_id}</span>
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
                  {c.fired_checks.length} of {c.checks_applicable} checks flagged something
                </div>
                {c.fired_checks.length === 0 ? (
                  <p className="font-sans text-micro text-fg-faint">
                    No automatic checks were recorded for this one.
                  </p>
                ) : (
                  c.fired_checks.map((f, i) => (
                    <div key={i} className="font-sans text-micro text-fg-primary">
                      <span className="text-accent-gold">{plainCheck(f.check)}</span>
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
                      assessment
                    </span>
                    <Pill tone="neutral" size="sm">
                      {c.llm_used ? "written by AI" : "standard wording"}
                    </Pill>
                  </div>
                  <p className="font-sans text-caption leading-relaxed text-fg-primary">
                    {truncateToSentence(c.judgment_text)}
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
