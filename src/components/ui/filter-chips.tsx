"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface FilterChipsProps {
  options: ReadonlyArray<string>;
  selected: string;
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
}

export function FilterChips({
  options,
  selected,
  onChange,
  className,
  ariaLabel,
}: FilterChipsProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]",
        "[&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {options.map((opt) => {
        const isActive = opt === selected;
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(opt)}
            className={cn(
              "tap-target shrink-0 whitespace-nowrap rounded-pill border px-3 py-1 font-sans text-micro uppercase tracking-wider transition-colors duration-fast",
              isActive
                ? "border-accent-cyan-soft bg-accent-cyan-soft/10 text-accent-cyan-soft-strong shadow-glow-subtle-cyan"
                : "border-border-subtle text-fg-muted hover:border-accent-cyan-soft/40 hover:text-fg-primary",
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
