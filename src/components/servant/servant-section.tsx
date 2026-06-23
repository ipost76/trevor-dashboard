"use client";
import * as React from "react";
import { ChevronDown, Download, RotateCcw, Crosshair } from "lucide-react";
import { EmptyState, Skeleton, Pill, ConfirmModal } from "@/components/ui";
import { fmtUsd } from "@/lib/shadow-aggregate";
import { cn } from "@/lib/utils";

// SERVANT (Edge-Hunter, B5) — the surface where Ghost reads the edge-hunter's
// findings and acts on them. READS /api/servant/findings (servant_findings WHERE
// handled=0, rank-ordered, READ-ONLY over the litestream replica) and DISPLAYS
// them as DAILY-EDGE-style ranked cards. Two actions only:
//   • Download report → streams the current rolling .md (/api/servant/report).
//   • Reset report    → round-trips to the VM (/api/servant/reset): marks
//     handled=1, NEVER deletes, NEVER clears what SERVANT learned. The page then
//     shows the empty state, ready for the next hunt.
// The Hub is READ-ONLY on the replica; the reset is the ONLY write and it targets
// the VM live db (the engine owns the write). Mirrors daily-edge-section.tsx
// (fetch + 60s poll + freshness badge + Hero/RunnerUp rank cards + honest states).
//
// HONESTY (load-bearing):
//   • The $ shown is realized_dollars — the engine's DEDUP'd per-distinct-trade Σ
//     (never a raw row-sum). Framed as "realized $ over N trades", not "$ if flipped".
//   • Empty / engine-not-run → an inviting empty state, never a fabricated edge.
//   • autopsy-job edges carry a coverage caveat so the sample is never overstated.

interface Evidence {
  source?: string;
  caveat?: string;
  coverage?: string;
  [k: string]: unknown;
}

interface Finding {
  id: number;
  created_at: number | null; // unix epoch seconds
  rank_score: number | null;
  dimension: string | null;
  title: string | null;
  description: string | null;
  evidence: Evidence | null;
  realized_dollars: number | null;
  n_distinct_trades: number | null;
  confidence: string | null;
  job: string | null;
}

interface ServantResponse {
  findings: Finding[];
  window_start_at: number | null;
  last_report_at: number | null;
  generated_at: number | null;
  open_count: number;
  replica_age_seconds: number | null;
  replica_mtime: string | null;
  error: string | null;
}

// ─── formatters ─────────────────────────────────────────────────────────────

function parseUnix(sec: number | null | undefined): Date | null {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return null;
  const d = new Date(sec * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtAgeShort(d: Date | null): string {
  if (!d) return "—";
  const sec = (Date.now() - d.getTime()) / 1000;
  if (sec < 0) return "just now";
  if (sec < 60) return `~${Math.floor(sec)}s`;
  if (sec < 3600) return `~${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `~${Math.floor(sec / 3600)}h`;
  return `~${Math.floor(sec / 86400)}d`;
}

function fmtAgeLong(d: Date | null): string {
  if (!d) return "generation time unknown";
  const sec = (Date.now() - d.getTime()) / 1000;
  if (sec < 60) return "generated moments ago";
  if (sec < 3600) return `generated ${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `generated ${Math.floor(sec / 3600)}h ago`;
  return `generated ${Math.floor(sec / 86400)}d ago`;
}

// Eastern-calendar datetime, matching the DAILY EDGE convention (settled, not live).
function fmtEt(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString(undefined, {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// confidence → gate-verdict Pill. The engine writes the gate verdict into the
// `confidence` column; map the known tokens, fall back to a neutral raw pill so a
// new/unrecognized value is shown honestly rather than dropped. READY = ready to
// act (mint), PROMISING = accruing (gold), NOT_READY = caution (neutral).
function verdictPill(confidence: string | null) {
  const c = (confidence ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (c === "ready" || c === "high")
    return <Pill intent="active" size="sm">READY</Pill>;
  if (c === "promising" || c === "med" || c === "medium")
    return <Pill intent="warn" size="sm">PROMISING</Pill>;
  if (c === "not_ready" || c === "low")
    return <Pill tone="neutral" size="sm">NOT READY</Pill>;
  if (!confidence) return <Pill tone="neutral" size="sm">unrated</Pill>;
  return <Pill tone="neutral" size="sm">{confidence}</Pill>;
}

function isAutopsy(job: string | null): boolean {
  return (job ?? "").toLowerCase().includes("autopsy");
}

// The coverage caveat for an autopsy edge: prefer an engine-written note, else a
// fixed honest line so the sample is never overstated.
function coverageCaveat(c: Finding): string | null {
  if (!isAutopsy(c.job)) {
    return c.evidence?.caveat ?? null;
  }
  const ev = c.evidence;
  return (
    ev?.coverage ??
    ev?.caveat ??
    "autopsy edge — derived from realized losers in the window; coverage is partial, not the full book."
  );
}

function evidenceSource(c: Finding): string | null {
  const s = c.evidence?.source;
  return typeof s === "string" && s.trim() ? s : null;
}

// ─── hero: rank #1 ────────────────────────────────────────────────────────────

function HeroCard({ c, rank }: { c: Finding; rank: number }) {
  const dollars = c.realized_dollars ?? 0;
  const positive = dollars > 0;
  const src = evidenceSource(c);
  const caveat = coverageCaveat(c);
  return (
    <section className="rounded-md border border-border-subtle border-l-2 border-l-accent-mint/60 bg-bg-card p-3 md:p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-caption tabular-nums text-fg-faint">#{rank}</span>
        <span className="font-sans text-micro uppercase tracking-wider text-fg-muted">
          top edge
        </span>
        <span className="font-sans text-caption font-semibold uppercase tracking-wide text-accent-plum-strong">
          {c.dimension ?? "—"}
        </span>
        <span className="ml-auto">{verdictPill(c.confidence)}</span>
      </div>

      <h2 className="mt-1.5 font-sans text-body font-semibold leading-snug text-fg-primary">
        {c.title ?? "Untitled edge"}
      </h2>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={cn(
            "font-mono text-h2 font-bold tabular-nums",
            positive ? "text-accent-mint-strong" : "text-accent-red",
          )}
        >
          {fmtUsd(dollars)}
        </span>
        <span className="font-mono text-micro tabular-nums text-fg-muted">
          realized · n={c.n_distinct_trades ?? 0} trades
        </span>
        {isAutopsy(c.job) && (
          <Pill tone="neutral" size="sm" className="text-fg-faint">
            autopsy
          </Pill>
        )}
      </div>

      {c.description && (
        <p className="mt-2 font-sans text-caption leading-relaxed text-fg-primary">
          {c.description}
        </p>
      )}
      {src && <p className="mt-1 font-mono text-micro text-fg-muted">src: {src}</p>}
      {caveat && (
        <p className="mt-1 font-sans text-micro leading-relaxed text-accent-gold-strong">
          {caveat}
        </p>
      )}
    </section>
  );
}

// ─── runner-up: compact, expandable ───────────────────────────────────────────

function RunnerUpCard({ c, rank }: { c: Finding; rank: number }) {
  const [expanded, setExpanded] = React.useState(false);
  const dollars = c.realized_dollars ?? 0;
  const positive = dollars > 0;
  const src = evidenceSource(c);
  const caveat = coverageCaveat(c);
  return (
    <section className="rounded-md border border-border-subtle bg-bg-card transition-colors duration-fast hover:border-accent-plum/40">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((x) => !x)}
        className="tap-target flex w-full items-center gap-3 px-3 py-2 text-left"
      >
        <span className="font-mono text-caption tabular-nums text-fg-faint">#{rank}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-sans text-caption font-semibold uppercase tracking-wide text-accent-plum-strong">
              {c.dimension ?? "—"}
            </span>
            <span
              className={cn(
                "font-mono text-caption font-bold tabular-nums",
                positive ? "text-accent-mint-strong" : "text-accent-red",
              )}
            >
              {fmtUsd(dollars)}
            </span>
            <span className="font-mono text-micro tabular-nums text-fg-muted">
              n={c.n_distinct_trades ?? 0}
            </span>
            {isAutopsy(c.job) && (
              <span className="font-sans text-micro text-fg-faint">autopsy</span>
            )}
          </div>
          <span className="truncate font-sans text-micro text-fg-muted">
            {c.title ?? "Untitled edge"}
          </span>
        </div>
        <span className="shrink-0">{verdictPill(c.confidence)}</span>
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
            {c.description && (
              <>
                <dt className="font-sans text-fg-muted">edge</dt>
                <dd className="text-fg-primary">{c.description}</dd>
              </>
            )}
            <dt className="font-sans text-fg-muted">realized $</dt>
            <dd className={positive ? "text-accent-mint-strong" : "text-accent-red"}>
              {fmtUsd(dollars)} over {c.n_distinct_trades ?? 0} distinct trades
            </dd>
            <dt className="font-sans text-fg-muted">verdict</dt>
            <dd className="text-fg-primary">{c.confidence ?? "unrated"}</dd>
            {src && (
              <>
                <dt className="font-sans text-fg-muted">source</dt>
                <dd className="text-fg-primary">{src}</dd>
              </>
            )}
            {caveat && (
              <>
                <dt className="font-sans text-fg-muted">caveat</dt>
                <dd className="text-accent-gold-strong">{caveat}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </section>
  );
}

// ─── section ───────────────────────────────────────────────────────────────

export function ServantSection() {
  const [data, setData] = React.useState<ServantResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [toast, setToast] = React.useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/servant/findings", { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch {
      // network errors swallow; keep last-good snapshot
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await load();
      if (cancelled) return;
    };
    run();
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [load]);

  // Toast auto-dismiss.
  React.useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 5_000);
    return () => window.clearTimeout(id);
  }, [toast]);

  // Download report — streams the current rolling .md from /api/servant/report
  // (Content-Disposition: attachment). Server stream, no client Blob.
  const handleDownload = React.useCallback(() => {
    const link = document.createElement("a");
    link.href = "/api/servant/report";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  // Reset report — round-trips to the VM (marks handled=1, never deletes, never
  // clears memory). On success the page goes to the empty state.
  const handleReset = React.useCallback(async () => {
    try {
      const res = await fetch("/api/servant/reset", { method: "POST" });
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && out.ok) {
        setToast({ kind: "ok", msg: "Report cleared — SERVANT keeps what it learned." });
        await load(); // refetch → empty state
      } else {
        setToast({ kind: "err", msg: out.error ?? `Reset failed (HTTP ${res.status})` });
      }
    } catch (e) {
      setToast({ kind: "err", msg: `Reset failed — ${String(e)}` });
    } finally {
      setConfirmOpen(false);
    }
  }, [load]);

  if (loading && !data) {
    return (
      <div className="p-4 md:p-6 lg:px-8">
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const findings = data?.findings ?? [];
  const hero = findings[0] ?? null;
  const runnerUps = findings.slice(1);
  const openCount = data?.open_count ?? findings.length;
  const generated = parseUnix(data?.generated_at ?? null);
  const windowStart = parseUnix(data?.window_start_at ?? null);

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      {/* Header: identity + window/generated-at (ET) + the two actions. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-2">
          <Crosshair size={16} aria-hidden className="text-accent-plum-strong" />
          <span className="font-sans text-h3 font-semibold tracking-tight text-fg-primary">
            SERVANT
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-sans text-micro text-fg-muted">
          <Pill intent="warn" size="sm">
            GENERATED {generated ? fmtAgeShort(generated) : "—"}
          </Pill>
          <span>{fmtAgeLong(generated)} · settled, not live</span>
          {windowStart && (
            <>
              <span className="text-fg-faint">·</span>
              <span className="font-mono tabular-nums">
                window since {fmtEt(windowStart)} ET
              </span>
            </>
          )}
        </div>

        {/* Actions (right-aligned). Download streams the rolling .md; Reset asks
            to confirm, then round-trips to the VM. */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDownload}
            title="Download the current rolling SERVANT report (.md) to take into a Claude.ai chat"
            className={cn(
              "tap-target inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-bg-card",
              "px-3 py-1.5 font-sans text-micro uppercase tracking-wider text-fg-muted",
              "transition-colors duration-fast hover:border-accent-cyan-soft/40 hover:text-accent-cyan-soft-strong",
            )}
          >
            <Download size={13} aria-hidden />
            Download report
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={openCount === 0}
            title={
              openCount === 0
                ? "Nothing to reset — no open edges"
                : "Mark all open edges handled (clears the report; never deletes what SERVANT learned)"
            }
            className={cn(
              "tap-target inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-bg-card",
              "px-3 py-1.5 font-sans text-micro uppercase tracking-wider text-fg-muted",
              "transition-colors duration-fast hover:border-accent-gold/50 hover:text-accent-gold-strong",
              "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border-subtle disabled:hover:text-fg-muted",
            )}
          >
            <RotateCcw size={13} aria-hidden />
            Reset report
          </button>
        </div>
      </div>

      {/* Toast — reset result. */}
      {toast && (
        <div
          className={cn(
            "rounded-md border px-3 py-2 font-sans text-caption",
            toast.kind === "ok"
              ? "border-accent-mint/40 bg-accent-mint/5 text-accent-mint-strong"
              : "border-accent-red/40 bg-accent-red/5 text-accent-red",
          )}
        >
          {toast.msg}
        </div>
      )}

      {/* Honest framing. */}
      <p className="font-sans text-micro leading-relaxed text-fg-muted">
        SERVANT hunts profit edges and ranks them{" "}
        <strong className="text-fg-primary">best-first</strong>. The dollar figure
        is the <span className="text-fg-primary">realized</span> $ over distinct
        trades (deduped, never a row-sum) — a measured footprint, not a promised
        &ldquo;$ if flipped&rdquo;. Download the report to address it in a chat, then
        reset to clear the inbox for the next hunt.
      </p>

      {data?.error ? (
        <EmptyState
          title="Unavailable"
          body={`SERVANT findings couldn't be read: ${data.error}`}
        />
      ) : findings.length === 0 ? (
        <EmptyState
          title="No open edges"
          body="SERVANT is hunting. New findings appear here each hour — ranked best, safest, and most profitable first."
        />
      ) : (
        <>
          {hero && <HeroCard c={hero} rank={1} />}
          {runnerUps.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="font-sans text-micro uppercase tracking-wider text-fg-muted">
                More edges ({runnerUps.length}) · ranked
              </h3>
              {runnerUps.map((c, i) => (
                <RunnerUpCard key={c.id ?? `${c.dimension}-${i}`} c={c} rank={i + 2} />
              ))}
            </section>
          )}
        </>
      )}

      <ConfirmModal
        isOpen={confirmOpen}
        title="Reset SERVANT report?"
        message={`Mark all ${openCount} open edge${openCount === 1 ? "" : "s"} as handled. This clears the report so the next hunt starts fresh. It NEVER deletes findings and NEVER clears what SERVANT has learned — the rows stay, only their handled flag flips.`}
        confirmLabel="Reset report"
        cancelLabel="Cancel"
        onConfirm={handleReset}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
