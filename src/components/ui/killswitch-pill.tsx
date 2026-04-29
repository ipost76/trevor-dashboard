"use client";
import { useEffect, useState } from "react";
import { Pill } from "./pill";

interface KillswitchState {
  enabled: boolean;
  lastToggle?: string;
  lastAuthor?: string;
  lastReason?: string;
  error?: string;
}

/**
 * Read-only Hub mirror of EMERGENCY_KILLSWITCH state.
 * Polls /api/killswitch every 5s; renders nothing when killswitch is OFF.
 *
 * Design intent (A2 2026-04-28; A4 ui-migration 2026-04-29):
 *  - Toggle is Discord-only via `!killswitch on/off`. There is NO POST endpoint
 *    and no UI button. This component is purely informational.
 *  - Fail-safe: 500/network error keeps last known state — never flickers off.
 *  - Built on the design-system <Pill tone="amber" pulse> primitive.
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
        // fail-safe: keep previous state
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

  const tip = `Killswitch ON · ${state.lastToggle ?? "(unknown time)"} by ${state.lastAuthor ?? "(unknown)"} · ${state.lastReason ?? "(no reason)"}`;

  return (
    <Pill tone="amber" pulse size="sm" title={tip}>
      Standby
    </Pill>
  );
}
