import * as React from "react";
import { Pill, type PillProps } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { FormulaStatus } from "./values";

/**
 * StatusBadge — the honesty layer. [B1, 2026-08-05]
 *
 * Every formula on /math carries one of these. It says what the formula is
 * ACTUALLY doing in the live system, not what it was designed to do.
 *
 * 🚨 `paper` IS AN OVERLAY, NOT AN ALTERNATIVE. Most sizing and fee entries are
 * `live` AND behind the paper gate. A bare 🟢 LIVE on one of those would tell
 * Ghost real money moved. `FormulaEntry` renders a second badge from its
 * `overlay` prop for exactly this; do not collapse the pair into one badge.
 *
 * Tones come from the existing `<Pill>` primitive — no new colour tokens, and
 * `pill.tsx` is not modified. `dormant` and `dead` share the neutral tone and
 * are told apart by their glyph plus the dimming on `dead`.
 */

type PillTone = NonNullable<PillProps["tone"]>;

interface StatusMeta {
  glyph: string;
  label: string;
  tone: PillTone;
  /** What the status means — surfaced as the pill's title attribute. */
  meaning: string;
  className?: string;
}

const STATUS_META: Record<FormulaStatus, StatusMeta> = {
  live: {
    glyph: "🟢",
    label: "LIVE",
    tone: "green",
    meaning: "Runs on every signal or position today.",
  },
  paper: {
    glyph: "🟡",
    label: "PAPER",
    tone: "amber",
    meaning: "Runs, but the fill is simulated — no real order leaves the box.",
  },
  dormant: {
    glyph: "⚪",
    label: "DORMANT",
    tone: "neutral",
    meaning: "Built and wired, but gated off.",
  },
  shadow: {
    glyph: "🔵",
    label: "SHADOW",
    tone: "cyan",
    meaning: "Computes on every candidate, but never acts.",
  },
  dead: {
    glyph: "⚫",
    label: "DEAD",
    tone: "neutral",
    meaning: "Unreachable, or arithmetically unable to act.",
    className: "opacity-60",
  },
  inert: {
    glyph: "🟠",
    label: "INERT",
    tone: "red",
    meaning: "Live-looking, but neutered by a live value.",
  },
  split: {
    glyph: "◐",
    label: "SPLIT",
    tone: "violet",
    meaning: "Two statuses at once — see the note.",
  },
};

export interface StatusBadgeProps {
  status: FormulaStatus;
  /**
   * Optional one-liner rendered beside the pill. `FormulaEntry` does NOT pass
   * this — it renders `statusNote` on its own line per the entry render order.
   * Use it when placing a badge standalone.
   */
  note?: string;
  className?: string;
}

export function StatusBadge({ status, note, className }: StatusBadgeProps) {
  const meta = STATUS_META[status];

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Pill tone={meta.tone} className={meta.className} title={meta.meaning}>
        <span aria-hidden="true">{meta.glyph}</span>
        {meta.label}
      </Pill>
      {note ? <span className="text-caption text-fg-muted">{note}</span> : null}
    </span>
  );
}

/** Exported so a section can explain the badge vocabulary without re-typing it. */
export function statusMeaning(status: FormulaStatus): string {
  return STATUS_META[status].meaning;
}
