"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type CompactShadowStatus = "active" | "dormant";

export interface CompactShadowCardProps {
  name: string;
  tableName: string;
  totalRows: number;
  rows48h: number;
  latestAge: string;
  status: CompactShadowStatus;
  /** A1 §1 group: "Entry" | "Exit" | "Scoring" | "Risk" | "Data". */
  function: string;
  extraMetrics?: Record<string, string | number>;
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toLocaleString();
  return String(n);
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
    extraMetrics,
  } = props;
  const [expanded, setExpanded] = React.useState(false);
  const isActive = status === "active";
  const dot = isActive ? "bg-accent-mint-strong" : "bg-fg-faint";

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
          <span className="font-mono text-micro text-fg-muted tabular-nums">
            {fmtNum(totalRows)} rows
          </span>
          <span className="font-mono text-micro text-fg-muted tabular-nums">
            {fmtNum(rows48h)} 48h
          </span>
          <span className="font-mono text-micro text-fg-faint">{latestAge}</span>
        </div>
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
