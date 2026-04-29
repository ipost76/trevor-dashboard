"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface TabBarItem<T extends string> {
  key: T;
  label: string;
  badge?: number | string;
}

export interface TabBarProps<T extends string> {
  items: ReadonlyArray<TabBarItem<T>>;
  active: T;
  onChange: (next: T) => void;
  className?: string;
}

export function TabBar<T extends string>({
  items,
  active,
  onChange,
  className,
}: TabBarProps<T>) {
  return (
    <div
      className={cn(
        "relative -mx-4 overflow-x-auto border-b border-border-subtle px-4 [scrollbar-width:none]",
        "[&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      <div className="flex min-w-max gap-1">
        {items.map((it) => {
          const isActive = it.key === active;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => onChange(it.key)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "tap-target relative flex items-center gap-2 px-3 py-2 text-caption uppercase tracking-wider transition-colors duration-fast",
                isActive ? "text-accent-cyan" : "text-fg-muted hover:text-fg-primary",
              )}
            >
              {it.label}
              {it.badge !== undefined && (
                <span className="rounded-pill bg-bg-elevated px-1.5 py-0.5 text-micro text-fg-muted">
                  {it.badge}
                </span>
              )}
              {isActive && (
                <span className="absolute bottom-0 left-2 right-2 h-px bg-accent-cyan shadow-glow-cyan" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
