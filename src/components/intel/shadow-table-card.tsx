"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, Pill } from "@/components/ui";
import { cn } from "@/lib/utils";
import { plainMetric } from "@/lib/plain-labels";

export type ShadowStatus = "ACTIVE" | "BROKEN" | "STALE" | "DORMANT";

export interface ShadowTableInfo {
  table_name: string;
  display: string;
  rows: number;
  rows_48h: number;
  latest_write: string | null;
  status: ShadowStatus;
  key_stat: Record<string, string | number>;
  error?: string | null;
}

const CARD_CLASS: Record<ShadowStatus, string> = {
  ACTIVE: "card-elevated",
  BROKEN: "card-warn",
  STALE: "card-warn",
  DORMANT: "card-base opacity-75",
};

function fmtAge(iso: string | null | undefined): string {
  if (!iso) return "never";
  // SQLite emits naive UTC ("YYYY-MM-DD HH:MM:SS"); append Z so the browser
  // parses it as UTC rather than local.
  const normalized = /[zZ]|[+-]\d\d:?\d\d$/.test(iso)
    ? iso.replace(" ", "T")
    : iso.replace(" ", "T") + "Z";
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  const ageSec = (Date.now() - d.getTime()) / 1000;
  if (ageSec < 0) return "just now";
  if (ageSec < 60) return `${Math.floor(ageSec)}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h ago`;
  return `${Math.floor(ageSec / 86400)}d ago`;
}

function fmtVal(v: string | number): string {
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toLocaleString();
    return v.toFixed(2);
  }
  return String(v);
}

function StatusPill({ status }: { status: ShadowStatus }) {
  if (status === "DORMANT") {
    return <Pill tone="neutral" size="sm">DORMANT</Pill>;
  }
  if (status === "ACTIVE") {
    return <Pill intent="active" size="sm">ACTIVE</Pill>;
  }
  if (status === "BROKEN") {
    return <Pill intent="error" size="sm">BROKEN</Pill>;
  }
  return <Pill intent="warn" size="sm">STALE</Pill>;
}

export function ShadowTableCard({ info }: { info: ShadowTableInfo }) {
  // 🚨 F1: ALLOWLISTED. This walked an arbitrary per-table `key_stat` dict and
  // labelled each row with fmtKey() — which only swapped underscores for spaces,
  // so "total_48h" became "total 48h". A de-underscored identifier is still an
  // identifier. Keys come from query_shadow_status.py's `_ks_*` functions; the
  // complete set of 29 is mapped in plain-labels.ts, and anything else is
  // counted rather than named.
  const named: Array<[string, string | number]> = [];
  let droppedKeys = 0;
  for (const [k, v] of Object.entries(info.key_stat ?? {})) {
    const label = plainMetric(k);
    if (label === null) droppedKeys++;
    else named.push([label, v]);
  }
  const keyEntries = named.slice(0, 4);
  droppedKeys += Math.max(0, named.length - 4);

  return (
    <Card padding="md" className={cn(CARD_CLASS[info.status], "flex flex-col gap-3")}>
      <CardHeader>
        <CardTitle>
          <span className="block truncate font-sans text-caption font-semibold normal-case tracking-tight text-fg-primary" title={info.display}>
            {info.display}
          </span>
        </CardTitle>
        <StatusPill status={info.status} />
      </CardHeader>

      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-h2 font-bold tabular-nums text-fg-primary">
          {info.rows.toLocaleString()}
        </span>
        <span className="font-sans text-micro uppercase tracking-wider text-fg-muted">
          rows
        </span>
      </div>

      <div className="space-y-1 border-t border-border-subtle pt-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-sans text-micro uppercase tracking-wider text-fg-muted">
            48h
          </span>
          <span className="font-mono text-micro tabular-nums text-fg-primary">
            {info.rows_48h.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="font-sans text-micro uppercase tracking-wider text-fg-muted">
            latest
          </span>
          <span
            className="font-mono text-micro tabular-nums text-fg-primary"
            title={info.latest_write ?? "never"}
          >
            {fmtAge(info.latest_write)}
          </span>
        </div>
      </div>

      {(keyEntries.length > 0 || droppedKeys > 0) && (
        <div className="space-y-1 border-t border-border-subtle pt-2">
          {keyEntries.map(([label, v]) => (
            <div key={label} className="flex items-center justify-between gap-2">
              <span className="truncate font-sans text-micro uppercase tracking-wider text-fg-muted" title={label}>
                {label}
              </span>
              <span className="font-mono text-micro tabular-nums text-fg-primary">
                {fmtVal(v)}
              </span>
            </div>
          ))}
          {droppedKeys > 0 && (
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-sans text-micro uppercase tracking-wider text-fg-faint">
                more
              </span>
              <span className="font-mono text-micro tabular-nums text-fg-faint">
                +{droppedKeys}
              </span>
            </div>
          )}
        </div>
      )}

      {/* F1: this printed `info.error`, which query_shadow_status.py builds as
          "key_stat error: <the raw Python exception>". The raw exception is now
          neither shown nor tooltipped — the card states the fact instead. */}
      {info.error && (
        <div className="font-sans text-micro italic text-accent-red">
          The extra statistics for this shadow could not be read.
        </div>
      )}
      {/* F1: the raw backing-table name that used to sit in this footer is gone;
          the card's title already identifies the shadow. */}
    </Card>
  );
}
