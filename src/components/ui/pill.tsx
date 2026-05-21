import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "cyan" | "green" | "amber" | "red" | "magenta" | "violet";
type Size = "sm" | "md";

// A4 v1.1 — refined status pill intents (additive, opt-in).
// When `intent` is provided it wins over `tone` and applies the refined
// desaturated visual using the new accent-cyan-soft / plum / mint / gold tokens.
type Intent =
  | "blue-chip"
  | "mid-cap"
  | "meme"
  | "live"
  | "active"
  | "running"
  | "warn"
  | "error";

const toneClass: Record<Tone, string> = {
  neutral: "bg-bg-elevated text-fg-muted border-border-subtle",
  cyan:    "bg-accent-cyan/10 text-accent-cyan border-accent-cyan/30",
  green:   "bg-accent-green/10 text-accent-green border-accent-green/30",
  amber:   "bg-accent-amber/10 text-accent-amber border-accent-amber/30",
  red:     "bg-accent-red/10 text-accent-red border-accent-red/30",
  magenta: "bg-accent-magenta/10 text-accent-magenta border-accent-magenta/30",
  violet:  "bg-accent-violet/10 text-accent-violet border-accent-violet/30",
};

const intentClass: Record<Intent, string> = {
  "blue-chip": "bg-accent-cyan-soft/10 text-accent-cyan-soft-strong border-accent-cyan-soft/30",
  "mid-cap":   "bg-accent-plum/10 text-accent-plum-strong border-accent-plum/30",
  // MEME can be loud — adds the subtle plum glow on top of the base.
  "meme":      "bg-accent-plum/15 text-accent-plum-strong border-accent-plum/40 shadow-glow-subtle-plum",
  "live":      "bg-accent-mint/10 text-accent-mint-strong border-accent-mint/30",
  "active":    "bg-accent-mint/10 text-accent-mint-strong border-accent-mint/30",
  "running":   "bg-accent-mint/10 text-accent-mint-strong border-accent-mint/30",
  "warn":      "bg-accent-gold/10 text-accent-gold-strong border-accent-gold/35",
  "error":     "bg-accent-red/10 text-accent-red border-accent-red/30",
};

const sizeClass: Record<Size, string> = {
  sm: "px-2 py-0.5 text-micro",
  md: "px-3 py-1 text-caption",
};

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** Refined status intent (A4 v1.1). Overrides `tone` when provided. */
  intent?: Intent;
  size?: Size;
  pulse?: boolean;
}

export function Pill({
  tone = "neutral",
  intent,
  size = "sm",
  pulse = false,
  className,
  children,
  ...rest
}: PillProps) {
  const variantClass = intent ? intentClass[intent] : toneClass[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border font-medium uppercase tracking-wider",
        variantClass,
        sizeClass[size],
        pulse && "animate-pulse-cyan",
        className,
      )}
      {...rest}
    >
      {pulse && <span className="h-1.5 w-1.5 rounded-pill bg-current" />}
      {children}
    </span>
  );
}
