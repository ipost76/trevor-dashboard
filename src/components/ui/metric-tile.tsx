import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "positive" | "negative" | "warn" | "cyan" | "magenta";
type Size = "sm" | "md" | "lg" | "hero";

const toneClass: Record<Tone, string> = {
  neutral: "text-fg-primary",
  positive: "text-accent-green",
  negative: "text-accent-red",
  warn: "text-accent-amber",
  cyan: "text-accent-cyan",
  magenta: "text-accent-magenta",
};

const sizeValue: Record<Size, string> = {
  sm: "text-h3",
  md: "text-h2",
  lg: "text-h1",
  hero: "text-display",
};

export interface MetricTileProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
  size?: Size;
  align?: "left" | "center" | "right";
  className?: string;
}

export function MetricTile({
  label,
  value,
  sub,
  tone = "neutral",
  size = "md",
  align = "left",
  className,
}: MetricTileProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1",
        align === "center" && "items-center text-center",
        align === "right" && "items-end text-right",
        className,
      )}
    >
      <span className="text-micro text-fg-muted">{label}</span>
      <span className={cn(sizeValue[size], "font-bold tabular-nums", toneClass[tone])}>{value}</span>
      {sub && <span className="text-caption text-fg-muted">{sub}</span>}
    </div>
  );
}
