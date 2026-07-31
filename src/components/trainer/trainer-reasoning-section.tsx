"use client";
import * as React from "react";
import { EmptyState, Pill, Skeleton } from "@/components/ui";
import { fmtAge } from "@/components/watcher/watcher-format";
import { plainGate } from "@/lib/plain-labels";

// TRAINER · "reasoning" sub-tab. The "why it was rejected" narrative from
// /api/trainer/reasoning (trainer.db rejection_log): the checks that failed, the
// real rationale, and the two numbers that killed each proposed setting.
// READ-ONLY. Pre-cutover EMPTY is the display — 0 rows render a friendly
// <EmptyState>, never an error.
//
// 🚨 The detail line used to read `{hash} · p={n} · dsr={n}` — a truncated hash
// nobody can act on plus two pieces of statistical notation. The numbers are
// kept; the notation and the hash are not.

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

function num(v: number | null | undefined, d = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toFixed(d);
}
/** A 0–1 probability as a readable percentage. */
function chance(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const p = v * 100;
  return p < 0.1 && p > 0 ? "<0.1%" : `${p.toFixed(1)}%`;
}
/** snake_case / kebab-case → Title Case English. */
// failing_gates may be an array of names or an object {gate: bool} — render as chips.
//
// 🚨 F1: ALLOWLISTED. These were rendered through a titleCase() that only
// swapped separators and capitalised, so a gate arrived on screen as "Dd
// ceiling" — a raw identifier wearing a capital letter. Gate names come from
// compass_metrics.py / trainer_validation.py and may carry a parenthesised
// reason, which plainGate() strips before lookup. Labels are de-duplicated
// because two variants of one gate collapse to a single label (and would
// otherwise collide as React keys).
function gateNames(g: unknown): { names: string[]; dropped: number } {
  const raw: string[] = [];
  if (Array.isArray(g)) raw.push(...g.map((x) => String(x)));
  else if (g && typeof g === "object") {
    raw.push(
      ...Object.entries(g as Record<string, unknown>)
        .filter(([, v]) => v === true || v === 1 || v === "fail")
        .map(([k]) => k),
    );
  } else if (typeof g === "string" && g.trim()) raw.push(g);

  const names: string[] = [];
  let dropped = 0;
  for (const r of raw) {
    const label = plainGate(r);
    if (label === null) dropped++;
    else if (!names.includes(label)) names.push(label);
  }
  return { names, dropped };
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
        Why the trainer turned settings down — the checks that failed, its
        reasoning, and how strong the evidence was.
      </p>

      {rejections.length === 0 ? (
        <EmptyState
          title="Nothing rejected yet"
          body="The trainer hasn't rejected anything yet. This fills in as it tests settings."
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
                {(gates.names.length > 0 || gates.dropped > 0) && (
                  <div className="flex flex-wrap items-center gap-1">
                    {gates.names.map((g) => (
                      <Pill key={g} intent="warn" size="sm">{g}</Pill>
                    ))}
                    {gates.dropped > 0 && (
                      <Pill tone="neutral" size="sm">{`+${gates.dropped} more`}</Pill>
                    )}
                  </div>
                )}
                <span className="font-sans text-micro text-fg-faint">
                  Setting {i + 1} ·{" "}
                  <span className="font-mono">{chance(r.p_value)}</span> chance this was
                  luck · quality score{" "}
                  <span className="font-mono">{num(r.dsr, 2)}</span>
                  {r.level_id !== null ? ` · Level ${r.level_id}` : ""}
                  {r.ts ? ` · ${fmtAge(r.ts)} ago` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
