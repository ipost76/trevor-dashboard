import * as React from "react";
import { cn } from "@/lib/utils";

export interface MoneyTextProps {
  value: number;
  unit?: "$" | "%";
  decimals?: number;
  showSign?: boolean;
  size?: "sm" | "md" | "lg" | "hero";
  className?: string;
}

const sizeCls: Record<NonNullable<MoneyTextProps["size"]>, string> = {
  sm: "text-body",
  md: "text-h3",
  lg: "text-h2",
  hero: "text-display",
};

export function MoneyText({
  value,
  unit = "$",
  decimals = 2,
  showSign = false,
  size = "md",
  className,
}: MoneyTextProps) {
  const tone =
    value > 0 ? "text-accent-green" : value < 0 ? "text-accent-red" : "text-fg-muted";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const abs = Math.abs(value).toFixed(decimals);
  const text =
    unit === "$"
      ? `${showSign ? sign : value < 0 ? "−" : ""}$${abs}`
      : `${showSign ? sign : value < 0 ? "−" : ""}${abs}%`;

  return (
    <span className={cn("font-mono font-bold tabular-nums", sizeCls[size], tone, className)}>
      {text}
    </span>
  );
}
