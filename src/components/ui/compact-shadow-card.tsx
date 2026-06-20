"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Pill } from "./pill";
import { fmtUsd, fmtPct, fmtCount } from "@/lib/shadow-aggregate";

export type CompactShadowStatus = "active" | "dormant" | "stale";
export type CompactPromotion = "ready" | "accruing" | "na";

export interface CompactShadowCardProps {
  name: string;
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
  /** Name of the boolean column divergentN was counted from (for the tooltip). */
  divergenceCol?: string | null;
  /** Promotion-readiness: ready (n≥30 + Wilson-LB>0) / accruing / na (no signal). */
  promotion?: CompactPromotion;
  /** Divergent-sample count toward the n≥30 threshold (for "accruing N/30"). */
  promotionN?: number | null;
  /** Writer flag-gated off; render a muted "retired" marker. */
  retired?: boolean;
  // HUB-C2 realized-outcome aggregates (read-only over existing columns).
  // null/absent ⇒ Group C ⇒ render "n/a — no per-trade outcome", never a WR.
  outcomeCol?: string | null;
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
 * Readiness badge — the ONLY thing on a collapsed row (and reused in the
 * leaderboard). Four states off the existing payload, all on A4 tokens:
 *   ready (gate-clear, mint) · accruing N/30 (building sample, gold) ·
 *   n/a (no divergence signal, neutral) · dormant (0-row / retired, dim).
 * Dormant status wins over promotion (a dormant table is never "ready").
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
    return <Pill intent="active" size="sm">ready</Pill>;
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
    tableName,
    totalRows,
    rows48h,
    latestAge,
    status,
    function: fnGroup,
    divergentN,
    divergencePct,
    divergenceCol,
    promotion = "na",
    promotionN,
    retired,
    outcomeCol,
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
  // Outcome shadow ⇔ a realized P&L column exists AND at least one row is linked.
  const hasOutcome =
    !!outcomeCol &&
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
            <dt className="font-sans text-fg-muted">table</dt>
            <dd className="truncate text-fg-primary">{tableName}</dd>
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
                <dt className="font-sans text-fg-muted">divergent</dt>
                <dd className="text-accent-gold-strong">
                  {fmtNum(divergentN ?? 0)} ({divergencePct}%)
                  {divergenceCol ? ` · ${divergenceCol}` : ""}
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
                <dt className="font-sans text-fg-muted">outcome col</dt>
                <dd className="truncate text-fg-faint">{outcomeCol}</dd>
              </>
            ) : (
              <>
                <dt className="font-sans text-fg-muted">win-rate</dt>
                <dd className="text-fg-faint italic">n/a — no per-trade outcome</dd>
              </>
            )}
            {extraMetrics &&
              Object.entries(extraMetrics).map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt className="font-sans text-fg-muted">{k}</dt>
                  <dd className="text-fg-primary">{String(v)}</dd>
                </React.Fragment>
              ))}
          </dl>
        </div>
      )}
    </section>
  );
}
