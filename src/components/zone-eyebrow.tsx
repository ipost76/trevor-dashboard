import * as React from "react";
import { cn } from "@/lib/utils";

// ZoneEyebrow — R12-B3 (H9) per-zone header pattern. A compact accent-colored
// identity strip that makes the TRAINER and WATCHER discovery cockpits visually
// separable at a glance, ON TOP of the existing design language. Token-only
// (refined A4 @theme accents — plum for TRAINER, cyan-soft for WATCHER, matching
// each zone's nav accent); adds NO new design system and touches NONE of the
// plain-English grammar (shadow-overview.tsx / memory-intel-section.tsx).

const CFG = {
  trainer: {
    label: "TRAINER",
    desc: "searches config space + proposes — Ghost approves, CC applies",
    border: "border-accent-plum",
    text: "text-accent-plum-strong",
    tint: "bg-accent-plum-subtle",
  },
  watcher: {
    label: "WATCHER",
    desc: "reviews the trainer + surfaces problems — observe-only",
    border: "border-accent-cyan-soft",
    text: "text-accent-cyan-soft-strong",
    tint: "bg-accent-cyan-soft-subtle",
  },
} as const;

export function ZoneEyebrow({ zone }: { zone: keyof typeof CFG }) {
  const c = CFG[zone];
  return (
    <div className={cn("flex items-baseline gap-2 rounded-md border-l-2 px-3 py-1.5", c.border, c.tint)}>
      <span className={cn("font-sans text-caption font-semibold uppercase tracking-[0.2em]", c.text)}>
        {c.label}
      </span>
      <span className="font-sans text-micro leading-tight text-fg-muted">{c.desc}</span>
    </div>
  );
}
