"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Pill } from "./pill";
import { fmtUsd, fmtPct, fmtCount } from "@/lib/shadow-aggregate";
import { plainMetric } from "@/lib/plain-labels";

export type CompactShadowStatus = "active" | "dormant" | "stale";
export type CompactPromotion = "ready" | "accruing" | "na";

export interface CompactShadowCardProps {
  name: string;
  /**
   * Backing table, kept for identity/keying by callers. 🚨 DELIBERATELY NOT
   * RENDERED (F1) — it named a storage location, not a fact about the shadow.
   */
  tableName: string;
  totalRows: number;
  rows48h: number;
  latestAge: string;
  status: CompactShadowStatus;
  /** A1 §1 group: "Entry" | "Exit" | "Scoring" | "Risk" | "Data" | "Other". */
  function: string;
  /** Count of divergent / would-fire rows; null when the table has no such column. */
  divergentN?: number | null;
  /** divergent / total, percent; null when not applicable. */
  divergencePct?: number | null;
  /** Promotion-readiness: ready (n≥30 + Wilson-LB>0) / accruing / na (no signal). */
  promotion?: CompactPromotion;
  /** Divergent-sample count toward the n≥30 threshold (for "accruing N/30"). */
  promotionN?: number | null;
  /** Writer flag-gated off; render a muted "retired" marker. */
  retired?: boolean;
  // HUB-C2 realized-outcome aggregates (read-only over existing columns).
  // false/absent ⇒ Group C ⇒ render "n/a — no per-trade outcome", never a WR.
  //
  // 🚨 F1: this was `outcomeCol?: string | null` — the NAME of the P&L column,
  // which the card printed verbatim. Only its truthiness was ever used, so it is
  // now a boolean. Changing the PROP (not just the render) is deliberate: the
  // caller passed the string literal, so a renderer-only fix would have left
  // "realized_pnl_usd" sitting in the shipped bundle.
  hasOutcomeColumn?: boolean;
  outcomeLinkedN?: number | null;
  outcomeMeanPnl?: number | null;
  outcomeMinPnl?: number | null;
  outcomeMaxPnl?: number | null;
  /** Win-rate % over LINKED rows; null when no realized outcome exists. */
  outcomeWinRate?: number | null;
  extraMetrics?: Record<string, string | number>;
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toLocaleString();
  return String(n);
}

/**
 * Divergence badge — the ONLY thing on a collapsed row (and reused in the
 * leaderboard). Four honest states off the existing payload, all on A4 tokens:
 *   diverges (n≥30 AND the Wilson lower bound of the divergence rate excludes 0
 *   = a statistically SIGNIFICANT divergence from live — NOT a promotion verdict;
 *   the real 7-component promotion gate is separate, RM-DECOM B5; mint) ·
 *   N/30 (building sample toward n≥30, gold) · n/a (no divergence signal,
 *   neutral) · dormant (0-row / retired, dim). Dormant status wins (a dormant
 *   table never shows a divergence signal).
 */
export function ReadinessBadge({
  status,
  promotion,
  promotionN,
}: {
  status: CompactShadowStatus;
  promotion: CompactPromotion;
  promotionN?: number | null;
}) {
  // STALE wins over everything — it's an alarm (registered active but gone silent).
  if (status === "stale") {
    return <Pill intent="error" size="sm">STALE</Pill>;
  }
  if (status === "dormant") {
    return (
      <Pill tone="neutral" size="sm" className="text-fg-faint">
        dormant
      </Pill>
    );
  }
  if (promotion === "ready") {
    // RM-DECOM B5: was "ready" (mint) — the display lie (single-component
    // Wilson-LB ≠ the 7-component promotion gate). Honest: the shadow's
    // divergence from live is statistically significant.
    return <Pill intent="active" size="sm">diverges</Pill>;
  }
  if (promotion === "accruing") {
    return <Pill intent="warn" size="sm">{`${promotionN ?? 0}/30`}</Pill>;
  }
  return <Pill tone="neutral" size="sm">n/a</Pill>;
}

/**
 * The one-line aggregate summary under each shadow's name. Three honest shapes:
 *   • outcome shadow  → WR Y% · μ $X · $A–$B · n=N (linked)
 *   • divergence-only → n=N · would-fire Z% · no per-trade outcome
 *   • neither         → n=N rows · n/a — no per-trade outcome
 * `would-fire %` is the divergence rate — deliberately NOT labelled a win-rate.
 */
function AggregateSummaryLine({
  hasOutcome,
  winRate,
  meanPnl,
  minPnl,
  maxPnl,
  linkedN,
  hasDiv,
  divergentN,
  divergencePct,
  totalRows,
}: {
  hasOutcome: boolean;
  winRate?: number | null;
  meanPnl?: number | null;
  minPnl?: number | null;
  maxPnl?: number | null;
  linkedN?: number | null;
  hasDiv: boolean;
  divergentN?: number | null;
  divergencePct?: number | null;
  totalRows: number;
}) {
  const Dot = () => <span className="text-fg-faint">·</span>;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-micro tabular-nums text-fg-muted">
      {hasOutcome ? (
        <>
          <span className="text-accent-mint-strong">WR {fmtPct(winRate)}</span>
          <Dot />
          <span>μ {fmtUsd(meanPnl)}</span>
          <Dot />
          <span className="text-fg-faint">
            {fmtUsd(minPnl)}–{fmtUsd(maxPnl)}
          </span>
          <Dot />
          <span>n={fmtCount(linkedN)} linked</span>
        </>
      ) : hasDiv ? (
        <>
          <span>n={fmtCount(divergentN ?? 0)}</span>
          <Dot />
          <span className="text-accent-gold-strong">would-fire {fmtPct(divergencePct)}</span>
          <Dot />
          <span className="text-fg-faint italic">no per-trade outcome</span>
        </>
      ) : (
        <>
          <span>n={fmtCount(totalRows)} rows</span>
          <Dot />
          <span className="text-fg-faint italic">n/a — no per-trade outcome</span>
        </>
      )}
    </div>
  );
}

export function CompactShadowCard(props: CompactShadowCardProps) {
  const {
    name,
    totalRows,
    rows48h,
    latestAge,
    status,
    function: fnGroup,
    divergentN,
    divergencePct,
    promotion = "na",
    promotionN,
    retired,
    hasOutcomeColumn,
    outcomeLinkedN,
    outcomeMeanPnl,
    outcomeMinPnl,
    outcomeMaxPnl,
    outcomeWinRate,
    extraMetrics,
  } = props;
  const [expanded, setExpanded] = React.useState(false);
  const isActive = status === "active";
  const isStale = status === "stale";
  const dot = isActive
    ? "bg-accent-mint-strong"
    : isStale
      ? "bg-accent-red"
      : "bg-fg-faint";
  const hasDiv = divergencePct !== null && divergencePct !== undefined;
  // Allowlist the optional extra rows: a key with no plain-English label is
  // counted, never rendered. See plain-labels.ts for why this returns null.
  const extraNamed: Array<[string, string]> = [];
  let extraDropped = 0;
  for (const [k, v] of Object.entries(extraMetrics ?? {})) {
    const label = plainMetric(k);
    if (label === null) extraDropped++;
    else extraNamed.push([label, String(v)]);
  }
  // Outcome shadow ⇔ a realized P&L column exists AND at least one row is linked.
  const hasOutcome =
    !!hasOutcomeColumn &&
    outcomeWinRate !== null &&
    outcomeWinRate !== undefined &&
    (outcomeLinkedN ?? 0) > 0;

  return (
    <section
      className={cn(
        "rounded-md border transition-colors duration-fast",
        isActive
          ? "border-border-subtle bg-bg-card hover:border-accent-cyan-soft/40"
          : isStale
            ? "border-accent-red/40 bg-bg-card"
            : "border-border-subtle bg-bg-card opacity-75",
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((x) => !x)}
        className="tap-target flex w-full items-center gap-3 px-3 py-2 text-left"
      >
        <span aria-hidden className={cn("mt-1 h-2 w-2 shrink-0 self-start rounded-pill", dot)} />
        {/* HUB-C2: name + one aggregate summary line. Every value is a rolled-up
            statistic over many entries — never a per-trade row. The stat line
            wraps (flex-wrap) so a phone never horizontal-scrolls. */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2 text-caption">
            <span className="truncate font-sans font-semibold text-fg-primary">
              {name}
            </span>
            {retired && (
              <span className="shrink-0 font-sans text-micro uppercase tracking-wider text-fg-faint">
                retired
              </span>
            )}
          </div>
          <AggregateSummaryLine
            hasOutcome={hasOutcome}
            winRate={outcomeWinRate}
            meanPnl={outcomeMeanPnl}
            minPnl={outcomeMinPnl}
            maxPnl={outcomeMaxPnl}
            linkedN={outcomeLinkedN}
            hasDiv={hasDiv}
            divergentN={divergentN}
            divergencePct={divergencePct}
            totalRows={totalRows}
          />
        </div>
        <span className="mt-0.5 shrink-0 self-start">
          <ReadinessBadge status={status} promotion={promotion} promotionN={promotionN} />
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          className={cn(
            "mt-0.5 shrink-0 self-start text-fg-muted transition-transform duration-fast",
            expanded ? "rotate-180" : "rotate-0",
          )}
        />
      </button>

      {expanded && (
        <div className="border-t border-border-subtle px-3 py-2 font-mono text-micro tabular-nums">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
            {/* F1: the raw `table` row is gone. It printed the backing DB table
                name, which names where the data is stored rather than anything
                about the shadow — the display name above already identifies it. */}
            <dt className="font-sans text-fg-muted">function</dt>
            <dd className="text-accent-cyan-soft-strong">{fnGroup}</dd>
            <dt className="font-sans text-fg-muted">status</dt>
            <dd
              className={
                isActive
                  ? "text-accent-mint-strong"
                  : isStale
                    ? "text-accent-red"
                    : "text-accent-gold-strong"
              }
            >
              {status}
            </dd>
            <dt className="font-sans text-fg-muted">total</dt>
            <dd className="text-fg-primary">{fmtNum(totalRows)}</dd>
            <dt className="font-sans text-fg-muted">48h</dt>
            <dd className="text-fg-primary">{fmtNum(rows48h)}</dd>
            <dt className="font-sans text-fg-muted">latest</dt>
            <dd className="text-fg-primary">{latestAge}</dd>
            {hasDiv && (
              <>
                {/* F1: this label read "divergent" — the boolean COLUMN's name.
                    "would-fire" is what the collapsed summary line above already
                    calls the same number, so the two now agree. */}
                <dt className="font-sans text-fg-muted">would-fire</dt>
                <dd className="text-accent-gold-strong">
                  {fmtNum(divergentN ?? 0)} ({divergencePct}%)
                </dd>
                <dt className="font-sans text-fg-muted">promotion</dt>
                <dd
                  className={
                    promotion === "ready"
                      ? "text-accent-mint-strong"
                      : promotion === "accruing"
                        ? "text-accent-gold-strong"
                        : "text-fg-muted"
                  }
                >
                  {promotion === "ready"
                    ? "ready (n≥30, Wilson-LB>0)"
                    : promotion === "accruing"
                      ? `accruing ${promotionN ?? 0}/30`
                      : "n/a"}
                </dd>
              </>
            )}
            {/* Realized-outcome aggregate sub-breakdown (HUB-C2) — aggregate
                stats only, never per-trade rows. Absent ⇒ honest n/a. */}
            {hasOutcome ? (
              <>
                <dt className="font-sans text-fg-muted">win-rate</dt>
                <dd className="text-accent-mint-strong">
                  {fmtPct(outcomeWinRate)} ({fmtCount(outcomeLinkedN)} linked)
                </dd>
                <dt className="font-sans text-fg-muted">mean P&amp;L</dt>
                <dd className="text-fg-primary">{fmtUsd(outcomeMeanPnl)}</dd>
                <dt className="font-sans text-fg-muted">range</dt>
                <dd className="text-fg-primary">
                  {fmtUsd(outcomeMinPnl)} – {fmtUsd(outcomeMaxPnl)}
                </dd>
                {/* F1: the `outcome col` row is gone — it printed the P&L
                    column's name, which tells a reader nothing the win-rate and
                    mean above do not already say. */}
              </>
            ) : (
              <>
                <dt className="font-sans text-fg-muted">win-rate</dt>
                <dd className="text-fg-faint italic">n/a — no per-trade outcome</dd>
              </>
            )}
            {/* F1: ALLOWLISTED. This walked an arbitrary key set and printed
                each key as its own <dt> — one call site and one known key today,
                so it was latent rather than live, but it is the same shape that
                five separate prompts have now found elsewhere. An unmapped key
                is counted, never named. */}
            {extraNamed.map(([label, text]) => (
              <React.Fragment key={label}>
                <dt className="font-sans text-fg-muted">{label}</dt>
                <dd className="text-fg-primary">{text}</dd>
              </React.Fragment>
            ))}
            {extraDropped > 0 && (
              <>
                <dt className="font-sans text-fg-muted">more</dt>
                <dd className="text-fg-faint">+{extraDropped} not shown</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </section>
  );
}
