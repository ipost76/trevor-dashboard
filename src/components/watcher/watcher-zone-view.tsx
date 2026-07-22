"use client";
import * as React from "react";
import { CritiqueSection } from "./critique-section";
import { ErrorsSection } from "./errors-section";
import { IntegritySection } from "./integrity-section";
import { LevelSection } from "./level-section";
import { MemoryIntelSection } from "@/components/memory/memory-intel-section";
import { ZoneEyebrow } from "@/components/zone-eyebrow";

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
      </div>
      {view}
    </div>
  );
}
