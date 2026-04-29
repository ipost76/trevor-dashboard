import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "cyan" | "green" | "amber" | "red" | "magenta" | "violet";
type Size = "sm" | "md";

const toneClass: Record<Tone, string> = {
  neutral: "bg-bg-elevated text-fg-muted border-border-subtle",
  cyan:    "bg-accent-cyan/10 text-accent-cyan border-accent-cyan/30",
  green:   "bg-accent-green/10 text-accent-green border-accent-green/30",
  amber:   "bg-accent-amber/10 text-accent-amber border-accent-amber/30",
  red:     "bg-accent-red/10 text-accent-red border-accent-red/30",
  magenta: "bg-accent-magenta/10 text-accent-magenta border-accent-magenta/30",
  violet:  "bg-accent-violet/10 text-accent-violet border-accent-violet/30",
};

const sizeClass: Record<Size, string> = {
  sm: "px-2 py-0.5 text-micro",
  md: "px-3 py-1 text-caption",
};

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  size?: Size;
  pulse?: boolean;
}

export function Pill({
  tone = "neutral",
  size = "sm",
  pulse = false,
  className,
  children,
  ...rest
}: PillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border font-medium uppercase tracking-wider",
        toneClass[tone],
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
