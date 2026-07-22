"use client";
import * as React from "react";
import { EmptyState, Pill, Skeleton } from "@/components/ui";

// TRAINER · "reasoning" sub-tab (R12-B1). The "why it was rejected" narrative
// from /api/trainer/reasoning (trainer.db rejection_log): the fired gates + the
// real rationale + the statistics (p_value, dsr) that killed each proposed
// config. READ-ONLY. Pre-cutover EMPTY is the display — 0 rows render a friendly
// <EmptyState>, never an error.

interface Rejection {
  id: number | null;
  arm_hash: string | null;
  level_id: number | null;
  config: unknown;
  failing_gates: unknown;
  rationale: string | null;
  p_value: number | null;
  dsr: number | null;
  ts: string | null;
}
interface ReasoningResponse {
  status: "ok" | "no_data_yet";
  rejections: Rejection[];
  count: number;
  error?: string;
}

function short(h: string | null): string {
  if (!h) return "—";
  return h.length > 12 ? `${h.slice(0, 12)}…` : h;
}
function num(v: number | null | undefined, d = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toFixed(d);
}
// failing_gates may be an array of names or an object {gate: bool} — render as chips.
function gateNames(g: unknown): string[] {
  if (Array.isArray(g)) return g.map((x) => String(x));
  if (g && typeof g === "object") {
    return Object.entries(g as Record<string, unknown>)
      .filter(([, v]) => v === true || v === 1 || v === "fail")
      .map(([k]) => k);
  }
  if (typeof g === "string" && g.trim()) return [g];
  return [];
}

export function TrainerReasoningSection() {
  const [data, setData] = React.useState<ReasoningResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/trainer/reasoning", { cache: "no-store" });
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

  const rejections = data?.rejections ?? [];

  if (loading && data === null) {
    return <Skeleton className="h-48 w-full" />;
  }

  return (
    <div className="space-y-4">
      <p className="font-sans text-micro leading-relaxed text-fg-muted">
        Why proposals were rejected — the gates that fired, the rationale, and the
        statistics (p-value, deflated Sharpe) that killed each config.
      </p>

      {rejections.length === 0 ? (
        <EmptyState
          title="Nothing rejected yet"
          body="The trainer hasn't logged a verdict — this fills in as the search loop evaluates configs."
        />
      ) : (
        <div className="space-y-1.5">
          {rejections.map((r, i) => {
            const gates = gateNames(r.failing_gates);
            return (
              <div
                key={r.id ?? i}
                className="flex flex-col gap-1 rounded-md border border-border-subtle bg-bg-card px-3 py-2"
              >
                <span className="font-sans text-caption leading-relaxed text-fg-primary">
                  {r.rationale ?? "—"}
                </span>
                {gates.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    {gates.map((g) => (
                      <Pill key={g} intent="warn" size="sm">{g}</Pill>
                    ))}
                  </div>
                )}
                <span className="font-mono text-micro text-fg-faint">
                  {short(r.arm_hash)} · p={num(r.p_value)} · dsr={num(r.dsr)}
                  {r.level_id !== null ? ` · L${r.level_id}` : ""}
                  {r.ts ? ` · ${r.ts}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
