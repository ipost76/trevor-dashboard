import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "cyan" | "green" | "amber" | "red";

const toneCls: Record<Tone, string> = {
  cyan: "bg-accent-cyan animate-pulse-cyan",
  green: "bg-accent-green animate-pulse-green",
  amber: "bg-accent-amber animate-pulse-amber",
  red: "bg-accent-red",
};

export interface LivePulseProps {
  tone?: Tone;
  label?: string;
  className?: string;
}

export function LivePulse({ tone = "cyan", label, className }: LivePulseProps) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className={cn("h-2 w-2 rounded-pill", toneCls[tone])} />
      {label && <span className="text-micro tracking-wider text-fg-muted">{label}</span>}
    </span>
  );
}
