"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { mathSectionAnchor } from "./values";

/**
 * MathSection — the wrapper every one of the 17 sections uses. [B1, 2026-08-05]
 *
 * Collapsible on mobile (Ghost reads this on a phone and the full page is long),
 * always expanded on lg+ where there is room. The collapse state is local — a
 * section does not remember it across navigations, which is the right default
 * for a reference page you land on via a table-of-contents link.
 *
 * The anchor id is derived from `number` via the shared `mathSectionAnchor()`,
 * so the page's table of contents can link to a section WITHOUT importing
 * anything from the D-prompt that builds it. A D-prompt only has to pass the
 * right number.
 */

export interface MathSectionProps {
  /** 1–17. Drives the rendered number and the anchor id. */
  number: number;
  title: string;
  /** Optional lead-in prose, rendered above the entries. */
  intro?: React.ReactNode;
  /** Override the derived anchor id. Rarely needed. */
  id?: string;
  children?: React.ReactNode;
}

export function MathSection({
  number,
  title,
  intro,
  id,
  children,
}: MathSectionProps) {
  const [open, setOpen] = React.useState(true);
  const anchor = id ?? mathSectionAnchor(number);
  const bodyId = `${anchor}-body`;

  return (
    <section id={anchor} className="scroll-mt-20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        className={cn(
          "flex w-full items-center gap-3 border-b border-border-subtle py-3 text-left",
          "min-h-11", // tap target
        )}
      >
        <span className="font-mono text-caption text-accent-cyan-soft-strong tabular-nums">
          {String(number).padStart(2, "0")}
        </span>
        <h2 className="text-h2 flex-1 text-fg-primary">{title}</h2>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-fg-muted transition-transform lg:hidden",
            open && "rotate-180",
          )}
        />
      </button>

      <div
        id={bodyId}
        className={cn("space-y-4 pt-4", !open && "hidden lg:block")}
      >
        {intro ? (
          <div className="text-caption-ui text-fg-muted">{intro}</div>
        ) : null}
        {children}
      </div>
    </section>
  );
}
