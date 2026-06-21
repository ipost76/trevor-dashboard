"use client";
import * as React from "react";
import { ChevronDown, Download } from "lucide-react";
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

// The engine writes evidence as a per-dimension object whose ONLY common key is
// `source` (the shadow/table + dedup key the edge derives from); the dimension
// cells (worst_cell/all_cells, by_level, leverage figures, fees) vary per
// candidate and are summarised by the engine inside `tweak`. The legacy
// string/counterfactual/shadows/trade_ids keys are kept for back-compat only.
interface Evidence {
  source?: string;
  shadows?: string[];
  trade_ids?: Array<string | number>;
  counterfactual?: string;
}

interface Candidate {
  id?: string;
  dimension: Dimension;
  tweak?: string; // engine's human one-liner — already carries n/WR/net
  edge_usd: number;
  n: number;
  safety_tag: string; // reasonable | caution | unsafe (unsafe filtered engine-side)
  reversibility: string; // flag-off | config | structural
  caveat?: string;
  evidence?: Evidence | string | null;
  forward_unpriced?: boolean;
  directional?: boolean;
}

interface WindowBounds {
  // The engine writes *_utc/*_et (e.g. start_utc "2026-06-20 16:00:00"); the
  // bare start/end are legacy fallbacks only.
  start_utc?: string;
  end_utc?: string;
  start_et?: string;
  end_et?: string;
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

// Evidence lead line — the engine's own `tweak` sentence (already carries
// n/WR/net), then legacy string/counterfactual shapes, else an honest "—".
function evidenceLine(c: Candidate): string {
  if (c.tweak && c.tweak.trim()) return c.tweak;
  const ev = c.evidence;
  if (typeof ev === "string" && ev.trim()) return ev;
  if (ev && typeof ev === "object" && ev.counterfactual) return ev.counterfactual;
  return "—";
}

// Provenance — the engine writes evidence.source (which shadow/table + dedup
// key). null when absent (string/legacy evidence) so callers can omit the line.
function evidenceSource(c: Candidate): string | null {
  const ev = c.evidence;
  if (ev && typeof ev === "object" && typeof ev.source === "string" && ev.source.trim())
    return ev.source;
  return null;
}

// ─── meta-prompt generator (C1) ──────────────────────────────────────────────
// Templates the already-fetched JSON into a short Markdown meta-prompt for a
// Claude.ai chat (which then writes the next Daily Recon CC prompt). Pure
// read-and-display: reads `data`, returns a string — never writes/recomputes.

// Filename day comes from the engine's generated_at (UTC), NOT the browser
// clock, so the filename matches the data's day. null → "latest".
function metaPromptFilename(generatedAt: string | null): string {
  const d = parseTs(generatedAt);
  const day = d ? d.toISOString().slice(0, 10) : "latest";
  return `daily_recon_metaprompt_${day}.md`;
}

function buildMetaPrompt(data: DailyEdgeResponse): string {
  const d = parseTs(data.generated_at);
  const day = d ? d.toISOString().slice(0, 10) : "today";
  const ws = data.window?.start_utc ?? data.window?.start;
  const we = data.window?.end_utc ?? data.window?.end;
  const windowLine = ws && we ? `${ws} → ${we} UTC` : "window unavailable";
  const cands = data.candidates ?? [];
  const top = data.today_candidate ?? cands[0] ?? null;
  const noTweak =
    data.verdict === "no_tweak_today" ||
    data.verdict === "not_generated_yet" ||
    data.verdict === "error" ||
    cands.length === 0;

  const lines: string[] = [`# TREVOR Daily Recon — Meta-Prompt (${day})`, ""];

  if (noTweak) {
    lines.push(
      "You are a Claude.ai chat. TREVOR's daily-edge engine reported " +
        `**${data.verdict}** for the window below — **no one-tweak candidate today**. ` +
        "Using this, write the **next Daily Recon CC prompt**: a read-only, WSL-pipe " +
        "forensic recon that posts a report to #downloads and writes " +
        "`data/daily_edge_candidates.json`. With no edge to sharpen on, write a " +
        "**standard** recon prompt that re-scans every dimension (entry, exit, sizing, " +
        "regime, direction, fees) at full A1 depth.",
      "",
      "## Today",
      `- verdict: **${data.verdict}**`,
      `- window: ${windowLine}`,
      `- generated: ${data.generated_at ?? "—"}`,
    );
    if (data.freshness_note) lines.push(`- note: ${data.freshness_note}`);
    lines.push("");
  } else {
    const topDim = top?.dimension ?? "the top dimension";
    lines.push(
      "You are a Claude.ai chat. Using today's TREVOR daily-edge data below, write the " +
        "**next Daily Recon CC prompt**: a read-only, WSL-pipe forensic recon that posts a " +
        "report to #downloads and writes `data/daily_edge_candidates.json`. Sharpen it on " +
        `what today's recon surfaced — especially the top candidate's dimension (**${topDim}**).`,
      "",
      "## Today",
      `- verdict: **${data.verdict}**`,
      `- window: ${windowLine}`,
      `- generated: ${data.generated_at ?? "—"}`,
      "",
      "## Ranked candidates (edge-first)",
    );
    cands.forEach((c, i) => {
      const flags: string[] = [];
      if (c.forward_unpriced) flags.push("⚠ forward-unpriced");
      if ((c.n ?? 0) < LOW_N) flags.push("low-n");
      const flagStr = flags.length ? ` · ${flags.join(" · ")}` : "";
      lines.push(
        `### #${i + 1} — ${c.dimension} · ${fmtUsd(c.edge_usd)} edge · n=${c.n ?? 0} · ` +
          `${c.safety_tag} · ${c.reversibility}${flagStr}`,
        evidenceLine(c),
      );
      const src = evidenceSource(c);
      const meta: string[] = [];
      if (src) meta.push(`source: ${src}`);
      if (c.caveat) meta.push(`caveat: ${c.caveat}`);
      if (meta.length) lines.push(meta.join(" | "));
      lines.push("");
    });
  }

  lines.push(
    "## Rules for the next prompt",
    "- Read-only — no writes, no shadow flips, no VM bot edits.",
    "- Dedup per trade (one realized outcome per trade key).",
    "- Honor edge-first ranking + per-tweak-n + recommendation-only.",
    "- Flag low-n (n<10) and forward_unpriced candidates as weaker signals.",
    "- Mirror the proven A1 recon depth.",
    "- Output: forensic report to #downloads + write data/daily_edge_candidates.json.",
    "",
  );
  return lines.join("\n");
}

// ─── hero: today's #1 ───────────────────────────────────────────────────────

function HeroCard({ c }: { c: Candidate }) {
  const weak = !!c.forward_unpriced || (c.n ?? 0) < LOW_N;
  const src = evidenceSource(c);
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
        {evidenceLine(c)}
      </p>
      {src && (
        <p className="mt-1 font-mono text-micro text-fg-muted">src: {src}</p>
      )}
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
  const src = evidenceSource(c);
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
            <dd className="text-fg-primary">{evidenceLine(c)}</dd>
            {src && (
              <>
                <dt className="font-sans text-fg-muted">source</dt>
                <dd className="text-fg-primary">{src}</dd>
              </>
            )}
            {c.caveat && (
              <>
                <dt className="font-sans text-fg-muted">caveat</dt>
                <dd className="text-accent-gold-strong">{c.caveat}</dd>
              </>
            )}
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

  // Download today's meta-prompt — templates the already-fetched JSON into a
  // Markdown handoff for a Claude.ai chat (client-side Blob, no server file).
  // Declared before the early return so the hook order never changes (HUB-C3).
  const handleDownloadMetaPrompt = React.useCallback(() => {
    if (!data) return;
    const md = buildMetaPrompt(data);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = metaPromptFilename(data.generated_at);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [data]);

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
  // Engine writes start_utc/end_utc; fall back to the legacy bare start/end.
  const windowStart = data?.window?.start_utc ?? data?.window?.start;
  const windowEnd = data?.window?.end_utc ?? data?.window?.end;

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      {/* Freshness badge — settled-but-delayed; never mistaken for live. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-micro text-fg-muted">
        <Pill intent="warn" size="sm">
          GENERATED {data?.generated_at ? fmtGeneratedShort(data.generated_at) : "—"}
        </Pill>
        <span>{fmtGeneratedLong(data?.generated_at ?? null)} · settled, not live</span>
        {windowStart && windowEnd && (
          <>
            <span className="text-fg-faint">·</span>
            <span className="font-mono tabular-nums">
              window {fmtDateShort(windowStart)}–{fmtDateShort(windowEnd)}
            </span>
          </>
        )}
        <button
          type="button"
          onClick={handleDownloadMetaPrompt}
          disabled={!data}
          title="Download a Markdown meta-prompt of today's candidates for a Claude.ai chat to write the next recon prompt"
          className={cn(
            "tap-target ml-auto inline-flex items-center gap-1.5 rounded-md border border-border-subtle",
            "bg-bg-card px-3 py-1.5 font-sans text-micro uppercase tracking-wider text-fg-muted",
            "transition-colors duration-fast hover:border-accent-cyan-soft/40 hover:text-accent-cyan-soft-strong",
            "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border-subtle disabled:hover:text-fg-muted",
          )}
        >
          <Download size={13} aria-hidden />
          Download recon prompt
        </button>
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
