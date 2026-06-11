"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Pill } from "./pill";

export type CompactShadowStatus = "active" | "dormant";
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
  extraMetrics?: Record<string, string | number>;
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toLocaleString();
  return String(n);
}

function PromotionPill({ promotion, promotionN }: { promotion: CompactPromotion; promotionN?: number | null }) {
  if (promotion === "ready") {
    return <Pill intent="active" size="sm">READY</Pill>;
  }
  if (promotion === "accruing") {
    return (
      <Pill intent="warn" size="sm">
        {`${promotionN ?? 0}/30`}
      </Pill>
    );
  }
  return null;
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
    extraMetrics,
  } = props;
  const [expanded, setExpanded] = React.useState(false);
  const isActive = status === "active";
  const dot = isActive ? "bg-accent-mint-strong" : "bg-fg-faint";
  const hasDiv = divergencePct !== null && divergencePct !== undefined;

  return (
    <section
      className={cn(
        "rounded-md border transition-colors duration-fast",
        isActive
          ? "border-border-subtle bg-bg-card hover:border-accent-cyan-soft/40"
          : "border-border-subtle bg-bg-card opacity-75",
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((x) => !x)}
        className="tap-target flex w-full items-center gap-3 px-3 py-2 text-left"
      >
        <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-pill", dot)} />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-caption">
          <span className="truncate font-sans font-semibold text-fg-primary">
            {name}
          </span>
          {retired && (
            <span className="font-sans text-micro uppercase tracking-wider text-fg-faint">
              retired
            </span>
          )}
          <span className="font-mono text-micro text-fg-muted tabular-nums">
            {fmtNum(totalRows)} rows
          </span>
          <span className="font-mono text-micro text-fg-muted tabular-nums">
            {fmtNum(rows48h)} 48h
          </span>
          {hasDiv && (
            <span
              className="font-mono text-micro tabular-nums text-accent-gold-strong"
              title={divergenceCol ? `divergent on "${divergenceCol}"` : "divergent"}
            >
              {fmtNum(divergentN ?? 0)} div · {divergencePct}%
            </span>
          )}
          <span className="font-mono text-micro text-fg-faint">{latestAge}</span>
        </div>
        <span className="shrink-0">
          <PromotionPill promotion={promotion} promotionN={promotionN} />
        </span>
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
        <div className="border-t border-border-subtle px-3 py-2 font-mono text-micro tabular-nums">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
            <dt className="font-sans text-fg-muted">table</dt>
            <dd className="truncate text-fg-primary">{tableName}</dd>
            <dt className="font-sans text-fg-muted">function</dt>
            <dd className="text-accent-cyan-soft-strong">{fnGroup}</dd>
            <dt className="font-sans text-fg-muted">status</dt>
            <dd
              className={
                isActive ? "text-accent-mint-strong" : "text-accent-gold-strong"
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
