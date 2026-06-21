"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { EmptyState, Skeleton, Pill } from "@/components/ui";
import { fmtUsd } from "@/lib/shadow-aggregate";
import { cn } from "@/lib/utils";

// DAILY EDGE (B2) — the at-a-glance viewpoint for the daily one-tweak loop.
// READS /api/daily-edge (the JSON a companion engine wrote into data/) and
// DISPLAYS today's #1 recommended tweak, the ranked runner-ups, and a small
// history strip. Read-and-display ONLY — never writes, never recomputes, never
// flips a rule. Mirrors shadow-rank-section.tsx (fetch + 60s poll + freshness
// badge + CompactShadowCard-style cards + honest empty states).
//
// HONESTY (load-bearing):
//   • verdict "no_tweak_today" → an honest "No tweak worth it today" state with
//     the reason — NEVER a fabricated candidate.
//   • verdict "not_generated_yet" → honest "engine hasn't run" state.
//   • forward_unpriced + low-n render visually WEAKER (dimmed + marker pills) so
//     the ranking never overstates a soft signal.
//   • the data is settled-but-delayed (engine writes a JSON with generated_at) →
//     a "generated ~Xh ago" badge so it's never mistaken for live.

type Verdict =
  | "tweak_recommended"
  | "no_tweak_today"
  | "not_generated_yet"
  | "error"
  | "unknown";
type Dimension = "entry" | "exit" | "sizing" | "regime" | "direction" | "fees" | string;

interface Evidence {
  shadows?: string[];
  trade_ids?: Array<string | number>;
  counterfactual?: string;
}

interface Candidate {
  dimension: Dimension;
  edge_usd: number;
  n: number;
  safety_tag: string; // reasonable | caution | unsafe (unsafe filtered engine-side)
  reversibility: string; // flag-off | config | structural
  evidence?: Evidence | string | null;
  forward_unpriced?: boolean;
}

interface WindowBounds {
  start?: string;
  end?: string;
}

interface HistoryEntry {
  date?: string;
  dimension?: string;
  edge_usd?: number;
  applied?: boolean;
  helped?: boolean | null;
}

interface DailyEdgeResponse {
  verdict: Verdict;
  today_candidate: Candidate | null;
  candidates: Candidate[];
  window: WindowBounds | null;
  generated_at: string | null;
  freshness_note: string | null;
  history: HistoryEntry[];
  error?: string;
}

// Low-n threshold below which a candidate's edge is rendered as a weaker signal.
const LOW_N = 10;

// ─── formatters ─────────────────────────────────────────────────────────────

// SQLite/engine may emit naive UTC; append Z so the browser parses as UTC
// (matches shadow-rank-section.tsx fmtAge).
function parseTs(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const normalized = /[zZ]|[+-]\d\d:?\d\d$/.test(iso)
    ? iso.replace(" ", "T")
    : iso.replace(" ", "T") + "Z";
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

// "~Xs/m/h/d" compact relative age for the freshness badge.
function fmtGeneratedShort(iso: string | null): string {
  const d = parseTs(iso);
  if (!d) return "~?";
  const sec = (Date.now() - d.getTime()) / 1000;
  if (sec < 0) return "just now";
  if (sec < 60) return `~${Math.floor(sec)}s`;
  if (sec < 3600) return `~${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `~${Math.floor(sec / 3600)}h`;
  return `~${Math.floor(sec / 86400)}d`;
}

function fmtGeneratedLong(iso: string | null): string {
  const d = parseTs(iso);
  if (!d) return "generation time unknown";
  const sec = (Date.now() - d.getTime()) / 1000;
  if (sec < 60) return "generated moments ago";
  if (sec < 3600) return `generated ${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `generated ${Math.floor(sec / 3600)}h ago`;
  return `generated ${Math.floor(sec / 86400)}d ago`;
}

function fmtDateShort(iso: string | undefined): string {
  if (!iso) return "—";
  const d = parseTs(iso);
  if (!d) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// safety_tag → Pill intent. reasonable=mint, caution=gold, unsafe=red (should be
// filtered engine-side; rendered red defensively if it ever appears).
function safetyPill(tag: string) {
  const t = (tag ?? "").toLowerCase();
  if (t === "reasonable") return <Pill intent="active" size="sm">reasonable</Pill>;
  if (t === "caution") return <Pill intent="warn" size="sm">caution</Pill>;
  if (t === "unsafe") return <Pill intent="error" size="sm">unsafe</Pill>;
  return <Pill tone="neutral" size="sm">{tag || "—"}</Pill>;
}

function reversibilityLabel(rev: string): string {
  const r = (rev ?? "").toLowerCase();
  if (r === "flag-off") return "flag-off (instant revert)";
  if (r === "config") return "config (easy revert)";
  if (r === "structural") return "structural (hard revert)";
  return rev || "—";
}

// One-line evidence summary — prefer the counterfactual, else a shadow/trade count.
function evidenceLine(ev: Candidate["evidence"]): string {
  if (!ev) return "no evidence summary";
  if (typeof ev === "string") return ev;
  if (ev.counterfactual) return ev.counterfactual;
  const parts: string[] = [];
  if (Array.isArray(ev.shadows) && ev.shadows.length)
    parts.push(`${ev.shadows.length} shadow${ev.shadows.length === 1 ? "" : "s"}`);
  if (Array.isArray(ev.trade_ids) && ev.trade_ids.length)
    parts.push(`${ev.trade_ids.length} trade${ev.trade_ids.length === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : "no evidence summary";
}

// ─── hero: today's #1 ───────────────────────────────────────────────────────

function HeroCard({ c }: { c: Candidate }) {
  const weak = !!c.forward_unpriced || (c.n ?? 0) < LOW_N;
  return (
    <section
      className={cn(
        "rounded-md border-l-2 border border-border-subtle bg-bg-card p-3 md:p-4",
        c.forward_unpriced ? "border-l-accent-gold/50" : "border-l-accent-mint/60",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-sans text-micro uppercase tracking-wider text-fg-muted">
          today&apos;s tweak
        </span>
        <span className="font-sans text-caption font-semibold uppercase tracking-wide text-accent-cyan-soft-strong">
          {c.dimension}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={cn(
            "font-mono text-h2 font-bold tabular-nums",
            weak ? "text-fg-muted" : "text-accent-mint-strong",
          )}
        >
          {fmtUsd(c.edge_usd)}
        </span>
        <span className="font-mono text-micro tabular-nums text-fg-muted">
          edge · n={c.n ?? 0}
        </span>
        {safetyPill(c.safety_tag)}
        {c.forward_unpriced && (
          <Pill tone="neutral" size="sm" className="text-fg-faint">
            forward-unpriced
          </Pill>
        )}
        {(c.n ?? 0) < LOW_N && (
          <Pill tone="neutral" size="sm" className="text-fg-faint">
            low-n
          </Pill>
        )}
      </div>
      <p className="mt-2 font-sans text-caption leading-relaxed text-fg-primary">
        {evidenceLine(c.evidence)}
      </p>
      <p className="mt-1 font-mono text-micro text-fg-muted">
        reversibility: {reversibilityLabel(c.reversibility)}
      </p>
    </section>
  );
}

// ─── runner-up: compact, expandable (CompactShadowCard style) ────────────────

function RunnerUpCard({ c, rank }: { c: Candidate; rank: number }) {
  const [expanded, setExpanded] = React.useState(false);
  const weak = !!c.forward_unpriced || (c.n ?? 0) < LOW_N;
  return (
    <section
      className={cn(
        "rounded-md border border-border-subtle bg-bg-card transition-colors duration-fast hover:border-accent-cyan-soft/40",
        weak && "opacity-75",
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((x) => !x)}
        className="tap-target flex w-full items-center gap-3 px-3 py-2 text-left"
      >
        <span className="font-mono text-caption tabular-nums text-fg-faint">#{rank}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-sans text-caption font-semibold uppercase tracking-wide text-fg-primary">
              {c.dimension}
            </span>
            <span
              className={cn(
                "font-mono text-caption font-bold tabular-nums",
                weak ? "text-fg-muted" : "text-accent-mint-strong",
              )}
            >
              {fmtUsd(c.edge_usd)}
            </span>
            <span className="font-mono text-micro tabular-nums text-fg-muted">n={c.n ?? 0}</span>
          </div>
          {weak && (
            <div className="flex flex-wrap items-center gap-1 font-sans text-micro text-fg-faint">
              {c.forward_unpriced && <span>forward-unpriced</span>}
              {c.forward_unpriced && (c.n ?? 0) < LOW_N && <span>·</span>}
              {(c.n ?? 0) < LOW_N && <span>low-n (weaker signal)</span>}
            </div>
          )}
        </div>
        <span className="shrink-0">{safetyPill(c.safety_tag)}</span>
        <ChevronDown
          size={14}
          aria-hidden
          className={cn(
            "shrink-0 text-fg-muted transition-transform duration-fast",
            expanded ? "rotate-180" : "rotate-0",
          )}
        />
      </button>
      {expanded && (
        <div className="border-t border-border-subtle px-3 py-2 font-mono text-micro">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="font-sans text-fg-muted">evidence</dt>
            <dd className="text-fg-primary">{evidenceLine(c.evidence)}</dd>
            <dt className="font-sans text-fg-muted">reversibility</dt>
            <dd className="text-fg-primary">{reversibilityLabel(c.reversibility)}</dd>
            <dt className="font-sans text-fg-muted">forward-priced</dt>
            <dd className={c.forward_unpriced ? "text-accent-gold-strong" : "text-fg-primary"}>
              {c.forward_unpriced ? "no — unpriced (weaker)" : "yes"}
            </dd>
          </dl>
        </div>
      )}
    </section>
  );
}

// ─── history strip ──────────────────────────────────────────────────────────

function HistoryRow({ h }: { h: HistoryEntry }) {
  let badge: React.ReactNode;
  if (!h.applied) {
    badge = (
      <Pill tone="neutral" size="sm" className="text-fg-faint">
        not applied
      </Pill>
    );
  } else if (h.helped === true) {
    badge = <Pill intent="active" size="sm">helped</Pill>;
  } else if (h.helped === false) {
    badge = <Pill intent="error" size="sm">no help</Pill>;
  } else {
    badge = <Pill intent="warn" size="sm">pending</Pill>;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-border-subtle bg-bg-card px-3 py-1.5">
      <span className="font-mono text-micro tabular-nums text-fg-muted">{fmtDateShort(h.date)}</span>
      <span className="font-sans text-caption uppercase tracking-wide text-fg-primary">
        {h.dimension ?? "—"}
      </span>
      <span className="font-mono text-micro tabular-nums text-fg-muted">
        {h.edge_usd === undefined ? "" : fmtUsd(h.edge_usd)}
      </span>
      <span className="ml-auto">{badge}</span>
    </div>
  );
}

// ─── section ────────────────────────────────────────────────────────────────

export function DailyEdgeSection() {
  const [data, setData] = React.useState<DailyEdgeResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/daily-edge", { cache: "no-store" });
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

  if (loading && !data) {
    return (
      <div className="p-4 md:p-6 lg:px-8">
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const verdict = data?.verdict ?? "unknown";
  const candidates = data?.candidates ?? [];
  const hero = data?.today_candidate ?? candidates[0] ?? null;
  // Runner-ups = the ranked list minus the #1 (edge-first; #1 is the hero).
  const runnerUps = candidates.slice(1);
  const history = data?.history ?? [];

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      {/* Freshness badge — settled-but-delayed; never mistaken for live. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-micro text-fg-muted">
        <Pill intent="warn" size="sm">
          GENERATED {data?.generated_at ? fmtGeneratedShort(data.generated_at) : "—"}
        </Pill>
        <span>{fmtGeneratedLong(data?.generated_at ?? null)} · settled, not live</span>
        {data?.window?.start && data?.window?.end && (
          <>
            <span className="text-fg-faint">·</span>
            <span className="font-mono tabular-nums">
              window {fmtDateShort(data.window.start)}–{fmtDateShort(data.window.end)}
            </span>
          </>
        )}
      </div>

      {/* Honest framing of the surface. */}
      <p className="font-sans text-micro leading-relaxed text-fg-muted">
        The day&apos;s #1 recommended tweak, ranked{" "}
        <strong className="text-fg-primary">edge-first</strong> by the engine.{" "}
        <span className="text-fg-faint">forward-unpriced</span> and{" "}
        <span className="text-fg-faint">low-n</span> render weaker — a soft signal,
        not proven money. This tab only displays what the engine decided; it never
        flips a rule.
      </p>

      {verdict === "not_generated_yet" ? (
        <EmptyState
          title="Not generated yet"
          body="The daily-edge engine hasn't written today's recommendation. This tab will populate once it runs."
        />
      ) : verdict === "error" ? (
        <EmptyState
          title="Unavailable"
          body={data?.error ?? "The daily-edge file is present but could not be read."}
        />
      ) : verdict === "no_tweak_today" || !hero ? (
        <section className="rounded-md border-l-2 border-l-border-subtle border border-border-subtle bg-bg-card p-3 md:p-4">
          <div className="font-sans text-caption font-semibold uppercase tracking-wider text-fg-muted">
            No tweak worth it today
          </div>
          <p className="mt-1.5 font-sans text-caption leading-relaxed text-fg-primary">
            {data?.freshness_note ??
              "The engine found no candidate today that clears the edge + safety bar. Holding steady is the honest call — no change recommended."}
          </p>
        </section>
      ) : (
        <>
          <HeroCard c={hero} />

          {runnerUps.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="font-sans text-micro uppercase tracking-wider text-fg-muted">
                Runner-ups ({runnerUps.length}) · edge-first
              </h3>
              {runnerUps.map((c, i) => (
                <RunnerUpCard key={`${c.dimension}-${i}`} c={c} rank={i + 2} />
              ))}
            </section>
          )}
        </>
      )}

      {/* History strip — prior days' chosen tweak + whether it helped. */}
      <section className="space-y-1.5">
        <h3 className="font-sans text-micro uppercase tracking-wider text-fg-muted">
          History {history.length > 0 ? `(${history.length})` : ""}
        </h3>
        {history.length === 0 ? (
          <p className="font-sans text-micro text-fg-faint">
            No prior tweaks recorded yet.
          </p>
        ) : (
          <div className="space-y-1">
            {history.map((h, i) => (
              <HistoryRow key={`${h.date ?? "d"}-${i}`} h={h} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
