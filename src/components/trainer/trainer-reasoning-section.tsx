"use client";
import * as React from "react";
import { EmptyState, Pill, Skeleton } from "@/components/ui";
import { fmtAge } from "@/components/watcher/watcher-format";

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
function titleCase(raw: string): string {
  const words = raw.replace(/[_-]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
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
                {gates.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    {gates.map((g) => (
                      <Pill key={g} intent="warn" size="sm">{titleCase(g)}</Pill>
                    ))}
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
