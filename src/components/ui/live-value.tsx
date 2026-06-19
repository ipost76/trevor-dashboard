"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface LiveValueProps {
  /** The numeric value to render. `null` or non-finite renders a neutral placeholder. */
  value: number | null;
  /** Formats the number for display. Defaults to a locale-aware numeric string. */
  format?: (n: number) => string;
  /** Extra classes merged onto the cell. */
  className?: string;
  /** How long the up/down flash holds before settling back to the resting color (ms). */
  flashMs?: number;
}

type Direction = "up" | "down" | "none";

const defaultFormat = (n: number): string => n.toLocaleString();

/** Read the user's reduced-motion preference (SSR-safe). */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function LiveValueImpl({
  value,
  format = defaultFormat,
  className,
  flashMs = 600,
}: LiveValueProps) {
  const numeric =
    typeof value === "number" && Number.isFinite(value) ? value : null;

  const prevRef = React.useRef<number | null>(numeric);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [direction, setDirection] = React.useState<Direction>("none");

  React.useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = numeric;

    // Flash only on a genuine number → different-number change.
    if (numeric === null || prev === null || numeric === prev) return;

    // Reduced motion: skip the flash entirely, settle at the resting color.
    if (prefersReducedMotion()) {
      setDirection("none");
      return;
    }

    setDirection(numeric > prev ? "up" : "down");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDirection("none"), flashMs);
  }, [numeric, flashMs]);

  // Clear any pending revert timer on unmount.
  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  if (numeric === null) {
    return (
      <span
        className={cn(
          "rounded-sm px-0.5 font-mono tabular-nums text-fg-muted",
          className,
        )}
      >
        —
      </span>
    );
  }

  const flashing = direction !== "none";
  const flashCls =
    direction === "up"
      ? "text-accent-mint bg-accent-mint-subtle"
      : direction === "down"
        ? "text-accent-red-strong bg-accent-red-subtle"
        : "text-fg-primary";

  // Snap to the flash color instantly (no transition while flashing), then
  // animate back to the resting color over flashMs once the timer reverts.
  return (
    <span
      className={cn(
        "rounded-sm px-0.5 font-mono tabular-nums",
        flashing ? "" : "transition-colors",
        flashCls,
        className,
      )}
      style={
        flashing ? { transition: "none" } : { transitionDuration: `${flashMs}ms` }
      }
    >
      {format(numeric)}
    </span>
  );
}

export const LiveValue = React.memo(LiveValueImpl);
