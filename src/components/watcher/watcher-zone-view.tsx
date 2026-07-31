"use client";
import * as React from "react";
import { CritiqueSection } from "./critique-section";
import { ErrorsSection } from "./errors-section";
import { IntegritySection } from "./integrity-section";
import { LevelSection } from "./level-section";
import { MemoryIntelSection } from "@/components/memory/memory-intel-section";
import { ZoneEyebrow } from "@/components/zone-eyebrow";
import { armingLine } from "./watcher-format";

/**
 * WATCHER zone dispatcher (R12-B2). Renders the cockpit surface where Ghost
 * reads the watcher's oversight — the teacher in the society of agents. Swaps
 * sections on the `?tab=` param (sub-tabs are query params app-wide).
 *
 * Sub-tabs:
 *   critique  — watcher_critiques (problems only; empty = nothing wrong found)
 *   errors    — watcher_errors + watcher_health (real live detections) [default]
 *   integrity — integrity_findings + reconciliation_log (dangerous-first)
 *   level     — the VM level chain, pure-ssh, hard UNKNOWN (H6)
 *   loops     — the KEPT loop_health glance (reuses <MemoryIntelSection>)
 *
 * READ-ONLY throughout — the WATCHER page displays oversight, it never acts.
 * Gated by memory/page.tsx behind HUB_REDESIGN_WATCHER (default OFF); the
 * `Memory` -> `Watcher` zone rename + the sub-tab strip live in navigation.ts
 * (B3's file). This dispatcher builds NO memory-store UI (that's B1) — the
 * `/memory` loop_health glance is a loop-liveness view, NOT R11's reasoning
 * store (the trap A1 flagged: they are completely different surfaces).
 */

interface WatcherZoneViewProps {
  subtab: string;
}

/**
 * The two sub-tabs NOT written by a watcher cycle: `level` reads the VM level
 * chain live over ssh, `loops` reads the replica's loop_health. An arming banner
 * over either would MANUFACTURE a staleness claim about data that is not stale.
 *
 * Expressed as the exclusion set, not the inclusion set, so it mirrors the
 * dispatcher's `default:` exactly — a stale `?tab=` renders <ErrorsSection/>,
 * which IS cycle-backed and must carry the banner with it.
 */
const NON_CYCLE_TABS = new Set(["level", "loops"]);

interface ArmingResp {
  watcher_cycle_ever_ran: boolean | null;
  watcher_last_cycle_at: string | null;
}

/**
 * Says when the watcher last actually ran, so a reader knows whether the panels
 * below are a live reading or a snapshot. The three-state copy lives in
 * `armingLine()` (watcher-format.ts) — a pure function, so each state can be
 * rendered and checked directly rather than inferred.
 */
function ArmingBanner() {
  const [arming, setArming] = React.useState<ArmingResp | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/watcher/critiques", { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) setArming(await res.json());
      } catch {
        // swallow — no response reads as UNKNOWN below, never as "never ran".
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Say nothing until we know something — an empty banner beats a guessed one.
  if (!loaded) return null;

  // No response at all means the same thing as an unreadable store: UNKNOWN.
  // `?? null` maps undefined -> null and leaves a real `false` alone.
  const { label, body, tone } = armingLine(
    arming?.watcher_cycle_ever_ran ?? null,
    arming?.watcher_last_cycle_at ?? null,
  );

  return (
    <div className={`rounded-md border p-3 ${tone}`}>
      <div className="font-sans text-micro font-semibold text-fg-primary">{label}</div>
      <p className="font-sans text-micro leading-relaxed text-fg-muted">{body}</p>
    </div>
  );
}

export function WatcherZoneView({ subtab }: WatcherZoneViewProps) {
  const view = (() => {
    switch (subtab) {
      case "critique":
        return <CritiqueSection />;
      case "integrity":
        return <IntegritySection />;
      case "level":
        return <LevelSection />;
      case "loops":
        return <MemoryIntelSection />;
      case "errors":
      default:
        return <ErrorsSection />;
    }
  })();

  return (
    <div className="mx-auto w-full max-w-screen-2xl">
      {/* R12-B3 flare: the WATCHER identity strip rides ABOVE the section (which
          owns its own padding) so {view} renders byte-identical to before. */}
      <div className="px-4 pt-4 md:px-6 lg:px-8">
        <ZoneEyebrow zone="watcher" />
        {!NON_CYCLE_TABS.has(subtab) && (
          <div className="mt-3">
            <ArmingBanner />
          </div>
        )}
      </div>
      {view}
    </div>
  );
}
