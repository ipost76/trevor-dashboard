"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Pill, type PillProps } from "./pill";
import { bitsWithDropped, plainNoteKey } from "@/lib/plain-labels";
import { cn } from "@/lib/utils";

/** One structured note pair as `query_activity.py` emits it (B13). */
export interface ActivityNotePair {
  key: string;
  value: string;
}

export interface ActivityRowProps {
  timestamp: string;
  keyName: string;
  oldValue: string | null;
  newValue: string;
  actor: string;
  sourceType: string;
  promptId?: string;
  /** Authored PROSE only. Machine text arrives as `notePairs`. */
  notes?: string;
  /**
   * Structured note pairs (B13, UO-4). The reader emits `[{key, value}]`; this
   * component decides the English via the `plainNoteKey` allowlist.
   */
  notePairs?: ActivityNotePair[];
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
  notePairs,
}: ActivityRowProps) {
  const [expanded, setExpanded] = React.useState(false);
  const intent = sourceIntent(sourceType);

  // B13 — gloss the structured note pairs. `plainNoteKey` is an ALLOWLIST using
  // own-property lookup: an unmapped key (and `__proto__` / `constructor`) comes
  // back null, so it is DROPPED and COUNTED rather than rendered. The tally goes
  // through `bitsWithDropped` as "+N more", keeping the loss visible instead of
  // silent. A raw key can never reach the screen through this path.
  const glossedNotes = React.useMemo(() => {
    if (!Array.isArray(notePairs) || notePairs.length === 0) return null;
    let dropped = 0;
    const labelled: { label: string; value: string }[] = [];
    for (const pair of notePairs) {
      const label = plainNoteKey(pair?.key);
      if (!label) {
        dropped += 1;
        continue;
      }
      labelled.push({ label, value: String(pair?.value ?? "") });
    }
    if (labelled.length === 0 && dropped === 0) return null;
    return { labelled, extra: bitsWithDropped([], dropped) };
  }, [notePairs]);

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
          {glossedNotes?.labelled.map((n) => (
            <React.Fragment key={n.label}>
              <dt className="font-sans text-fg-muted">{n.label}</dt>
              <dd className="font-sans text-fg-primary">{n.value}</dd>
            </React.Fragment>
          ))}
          {glossedNotes?.extra.map((e) => (
            <React.Fragment key={e}>
              <dt className="font-sans text-fg-muted" />
              <dd className="font-sans text-fg-faint">{e}</dd>
            </React.Fragment>
          ))}
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
