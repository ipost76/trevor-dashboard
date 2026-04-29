"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SegmentedToggleOption<T extends string> {
  value: T;
  label: string;
  tone?: "neutral" | "cyan" | "green" | "amber" | "red" | "magenta";
}

export interface SegmentedToggleProps<T extends string> {
  options: ReadonlyArray<SegmentedToggleOption<T>>;
  value: T;
  onChange: (next: T) => void;
  size?: "sm" | "md";
  full?: boolean;
  ariaLabel?: string;
  className?: string;
}

export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  full = false,
  ariaLabel,
  className,
}: SegmentedToggleProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border-subtle bg-bg-card p-1",
        full && "w-full",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "tap-target flex-1 rounded-sm font-mono uppercase tracking-wider transition-colors duration-fast",
              size === "sm" ? "px-2 py-1 text-micro" : "px-3 py-1.5 text-caption",
              active
                ? "bg-bg-elevated text-fg-primary shadow-glow-cyan"
                : "text-fg-muted hover:text-fg-primary",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
