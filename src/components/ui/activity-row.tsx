"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Pill, type PillProps } from "./pill";
import { cn } from "@/lib/utils";

export interface ActivityRowProps {
  timestamp: string;
  keyName: string;
  oldValue: string | null;
  newValue: string;
  actor: string;
  sourceType: string;
  promptId?: string;
  notes?: string;
}

function parseUTC(ts: string | null | undefined): Date {
  if (!ts) return new Date(NaN);
  let s = ts.includes("T") ? ts : ts.replace(" ", "T");
  if (!/Z$|[+-]\d\d:?\d\d$/.test(s)) s += "Z";
  return new Date(s);
}

function fmtAge(ts: string): string {
  const d = parseUTC(ts);
  if (!Number.isFinite(d.getTime())) return ts;
  const diffMs = Date.now() - d.getTime();
  const s = Math.max(0, Math.floor(diffMs / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

function sourceIntent(sourceType: string): PillProps["intent"] {
  const s = sourceType.toUpperCase();
  if (s === "UI") return "blue-chip";
  if (s === "DISCORD") return "mid-cap";
  if (s === "AUTONOMOUS") return "warn";
  if (s === "CC" || s === "CLAUDE") return "active";
  return undefined;
}

export function ActivityRow({
  timestamp,
  keyName,
  oldValue,
  newValue,
  actor,
  sourceType,
  promptId,
  notes,
}: ActivityRowProps) {
  const [expanded, setExpanded] = React.useState(false);
  const intent = sourceIntent(sourceType);

  return (
    <div className="border-b border-border-subtle last:border-b-0">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((x) => !x)}
        className="tap-target flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-bg-elevated/40"
      >
        <span
          className="font-mono text-micro text-fg-muted tabular-nums"
          title={timestamp}
        >
          {fmtAge(timestamp)}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-caption">
          <span className="font-sans font-semibold text-fg-primary">{keyName}</span>
          <span className="font-mono text-micro text-fg-muted tabular-nums">
            {oldValue ?? "∅"}
            <span className="mx-1 text-fg-faint">→</span>
            <span className="text-accent-cyan-soft-strong">{newValue}</span>
          </span>
          <Pill intent={intent} size="sm">
            {sourceType}
          </Pill>
        </div>
        <ChevronDown
          size={14}
          aria-hidden
          className={cn(
            "mt-0.5 shrink-0 text-fg-muted transition-transform duration-fast",
            expanded ? "rotate-180" : "rotate-0",
          )}
        />
      </button>

      {expanded && (
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 px-3 pb-3 font-mono text-micro tabular-nums">
          <dt className="font-sans text-fg-muted">actor</dt>
          <dd className="text-fg-primary">{actor}</dd>
          <dt className="font-sans text-fg-muted">source</dt>
          <dd className="text-fg-primary">{sourceType}</dd>
          {promptId && (
            <>
              <dt className="font-sans text-fg-muted">prompt</dt>
              <dd className="text-accent-plum-strong">{promptId}</dd>
            </>
          )}
          {notes && (
            <>
              <dt className="font-sans text-fg-muted">notes</dt>
              <dd className="font-sans text-fg-primary">{notes}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
