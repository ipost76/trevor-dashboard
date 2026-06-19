"use client";

import * as React from "react";
import { Pill } from "./pill";
import { useLiveTerminal } from "@/lib/live-terminal";
import { useLiveStatus, type LiveStatus } from "@/lib/hl-ws-store";

/**
 * LIVE / RECONNECTING / STALE status pill for the live-terminal feed [B8].
 *
 * Honesty + DO-NO-HARM contract:
 *  - Renders NOTHING when the live-terminal flag is OFF, or when the feed is
 *    `idle` (no `useLiveMark` subscriber is mounted → no socket). So with the
 *    flag off the pill has zero layout footprint and the Hub is unchanged.
 *  - `useLiveStatus` is a PASSIVE observer — reading it never opens a socket, so
 *    mounting this pill cannot, by itself, cause a connection.
 *  - A dropped feed shows RECONNECTING (neutral) / STALE (amber) — never a
 *    frozen "LIVE". Displayed prices fall back to `/api/prices` elsewhere; this
 *    pill makes the degraded state legible rather than letting it look live.
 *
 * Reuses the shared `<Pill>` primitive for styling (live → mint `intent="live"`,
 * stale → gold `intent="warn"`, reconnecting → neutral `tone`). Accessible
 * (`role="status"` + `aria-label`) and reduced-motion safe (the live pulse is
 * suppressed when the user prefers reduced motion).
 */

type RenderableStatus = Exclude<LiveStatus, "idle">;

interface PillSpec {
  label: string;
  aria: string;
  intent?: "live" | "warn";
  tone?: "neutral";
}

const SPEC: Record<RenderableStatus, PillSpec> = {
  live: { label: "LIVE", aria: "Live prices streaming", intent: "live" },
  reconnecting: {
    label: "RECONNECTING",
    aria: "Reconnecting to the live price feed",
    tone: "neutral",
  },
  stale: {
    label: "STALE",
    aria: "Live prices are stale and may be delayed",
    intent: "warn",
  },
};

/** SSR-safe `prefers-reduced-motion` reader (false on the server / first paint). */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return reduced;
}

export interface LiveStatusPillProps {
  /** Extra classes merged onto the pill. */
  className?: string;
}

export function LiveStatusPill({ className }: LiveStatusPillProps) {
  const flagOn = useLiveTerminal();
  const status = useLiveStatus(flagOn);
  const reducedMotion = usePrefersReducedMotion();

  // Flag OFF, or no subscriber streaming → render nothing (zero footprint).
  if (!flagOn || status === "idle") return null;

  const spec = SPEC[status];
  return (
    <Pill
      intent={spec.intent}
      tone={spec.tone}
      size="sm"
      pulse={status === "live" && !reducedMotion}
      role="status"
      aria-label={spec.aria}
      className={className}
    >
      {spec.label}
    </Pill>
  );
}
