"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
  className?: string;
}

export function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
  rightSlot,
  className,
}: CollapsibleSectionProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const headingId = React.useId();
  const panelId = React.useId();

  return (
    <section className={cn("rounded-lg border border-border-subtle bg-bg-card", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        id={headingId}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "tap-target flex w-full items-center justify-between gap-3 px-4 py-3 text-left",
          "transition-colors duration-fast hover:bg-bg-elevated",
          "focus:outline-none focus-visible:outline-2 focus-visible:outline-accent-cyan/60 focus-visible:outline-offset-2",
        )}
      >
        <span className="flex items-center gap-2">
          <ChevronDown
            size={16}
            className={cn(
              "text-fg-muted transition-transform duration-medium",
              open ? "rotate-0" : "-rotate-90",
            )}
          />
          <span className="text-h3 font-bold uppercase tracking-wider text-fg-primary">
            {title}
          </span>
        </span>
        {rightSlot}
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={headingId}
        hidden={!open}
        className={open ? "border-t border-border-subtle" : undefined}
      >
        {open && children}
      </div>
    </section>
  );
}
