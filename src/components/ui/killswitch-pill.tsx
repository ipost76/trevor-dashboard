"use client";
import { useEffect, useState } from "react";
import { Pill } from "./pill";

interface KillswitchState {
  /** 🚨 null is the UNKNOWN value, never false. See killswitch_state. */
  enabled: boolean | null;
  /** C3's three-state discriminator. Absent on a pre-fix cached payload. */
  killswitch_state?: "engaged" | "disengaged" | "unknown";
  lastToggle?: string;
  lastAuthor?: string;
  lastReason?: string;
  error?: string;
}

/**
 * Read-only Hub mirror of EMERGENCY_KILLSWITCH state in the topbar.
 * Polls /api/killswitch every 5s.
 *
 * Design intent (A2 2026-04-28; A4 ui-migration 2026-04-29; Hub-Only
 * Control Doctrine 2026-05-02):
 *  - Toggle now lives at MEMORY → System Health (`<KillswitchControlCard>`)
 *    which POSTs `/api/killswitch` (the SAME endpoint this pill polls).
 *    This pill is purely informational — no buttons, no modals.
 *  - Built on the design-system <Pill> primitive.
 *
 * 🚨 THREE STATES, NOT TWO (B2-HUB-READER-HONESTY, 2026-08-04):
 *    ENGAGED     → "Standby" (red-warn, pulsing) — UNCHANGED
 *    DISENGAGED  → renders nothing — UNCHANGED
 *    UNKNOWN     → "Killswitch ?" (gold warn) — NEW; used to render NOTHING
 *
 * C3 (`184bb6a`) fixed the whole producer chain so `/api/killswitch` can now
 * answer `killswitch_state: "unknown"` with `enabled: null` — and explicitly
 * left this renderer, which was the half that made the answer visible. Until
 * now the seeded `{ enabled: false }` plus `if (!state.enabled) return null`
 * collapsed BOTH "no reading yet" and "the read failed" into the disengaged
 * branch, so an UNKNOWN killswitch simply VANISHED from the topbar. Under-
 * warning by OMISSION is the same principle failing: the operator sees an empty
 * space where a safety control should be, which is indistinguishable from the
 * safe state.
 *
 * ⚠️ The old header line "Fail-safe: 500/network error keeps last known state —
 * never flickers off" described the DEFECT as if it were the feature. There was
 * no last known state to keep on first paint: the seed WAS `false`.
 */
export function KillswitchPill() {
  // 🚨 The unknown default. The pill may not claim DISENGAGED before it has
  // read anything — and "renders nothing" is a claim of disengaged.
  const [state, setState] = useState<KillswitchState>({
    enabled: null,
    killswitch_state: "unknown",
  });

  useEffect(() => {
    let alive = true;
    const fetchState = async () => {
      try {
        const res = await fetch("/api/killswitch", { cache: "no-store" });
        if (!res.ok) {
          // The route returns HTTP 500 on a genuine helper failure and its body
          // already says unknown — but the status is checked here so a future
          // non-2xx that carries NO body can never be parsed into a state.
          if (alive) setState({ enabled: null, killswitch_state: "unknown", error: `HTTP ${res.status}` });
          return;
        }
        const data = (await res.json()) as KillswitchState;
        if (alive) setState(data);
      } catch {
        // Network failure / unparseable body — say UNKNOWN, never inherit.
        if (alive) setState({ enabled: null, killswitch_state: "unknown", error: "unreachable" });
      }
    };
    fetchState();
    const id = setInterval(fetchState, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // 🚨 THE ONE-LINE FIX, AND ITS EXACT SHAPE MATTERS.
  // This was `if (!state.enabled) return null`, which swallowed null (UNKNOWN)
  // into the same silence as false (DISENGAGED). The test is now against the
  // LITERAL false, so ONLY a read that actually said "disengaged" can hide the
  // pill. null falls through to the UNKNOWN branch below.
  if (state.enabled === false) return null;

  // UNKNOWN — the read failed or has not happened yet. Say so; never occupy the
  // disengaged silence. Deliberately NOT the red ENGAGED treatment: this is not
  // a claim that the killswitch is on, it is a claim that we do not know.
  if (state.enabled !== true) {
    return (
      <Pill
        intent="warn"
        size="sm"
        title="Killswitch state could not be read. This is NOT an all-clear — the emergency stop may be engaged or disengaged. Check the bot directly before acting."
      >
        Killswitch ?
      </Pill>
    );
  }

  const tip = `Killswitch ON · ${state.lastToggle ?? "(unknown time)"} by ${state.lastAuthor ?? "(unknown)"} · ${state.lastReason ?? "(no reason)"}`;

  return (
    <Pill intent="warn" pulse size="sm" title={tip}>
      Standby
    </Pill>
  );
}
