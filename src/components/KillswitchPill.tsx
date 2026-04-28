"use client";

import { useEffect, useState } from "react";

interface KillswitchState {
  enabled: boolean;
  lastToggle?: string;
  lastAuthor?: string;
  lastReason?: string;
  error?: string;
}

/**
 * Read-only Hub mirror for the EMERGENCY_KILLSWITCH state.
 * Polls /api/killswitch every 5 s. Renders nothing when killswitch is OFF
 * — visible only as an amber STANDBY pill when ON.
 *
 * Design intent (2026-04-28 A2):
 * - Toggle is Discord-only via `!killswitch on/off`. There is NO POST endpoint
 *   and no UI button. This component is purely informational.
 * - Fail-safe: 500 / network error → keep last known state. Stays hidden if
 *   DB unreachable, because state defaults to {enabled: false}.
 * - Tailwind palette matches Hub cyberpunk theme (#ffa502 amber).
 */
export function KillswitchPill() {
  const [state, setState] = useState<KillswitchState>({ enabled: false });

  useEffect(() => {
    let alive = true;
    const fetchState = async () => {
      try {
        const res = await fetch("/api/killswitch", { cache: "no-store" });
        const data = (await res.json()) as KillswitchState;
        if (alive) setState(data);
      } catch {
        // fail-safe: keep previous state — don't flicker the pill on transient errors
      }
    };
    fetchState();
    const id = setInterval(fetchState, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!state.enabled) return null;

  const tip = `Killswitch ON · ${state.lastToggle || "(unknown time)"} by ${state.lastAuthor || "(unknown)"} · ${state.lastReason || "(no reason)"}`;

  return (
    <div
      className="flex items-center gap-1.5 rounded border border-[rgba(255,165,2,0.4)] bg-[rgba(255,165,2,0.1)] px-1.5 py-0.5"
      title={tip}
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ffa502]" />
      <span className="text-[10px] font-bold tracking-[0.1em] uppercase text-[#ffa502]">
        STANDBY
      </span>
    </div>
  );
}
