"use client";
import * as React from "react";
import { MemoryIntelSection } from "./memory-intel-section";

/**
 * /memory zone view — Memory & Intelligence (single-view zone).
 *
 * RM-HUB-INTEL B2 (2026-07-11) stripped the 4 raw MEMORY sub-tabs (Brain /
 * Memory / ChromaDB / Aggressive) and their section components; the zone is now
 * the single quick-glance loop_health dashboard (<MemoryIntelSection/>).
 * `<ZoneSubTabs />` auto-hides on this zone because `subTabs` was dropped from
 * the memory zone entry in navigation.ts (same pattern as the /docs single-view
 * zone). The switch shape is retained to absorb any stale
 * `?tab=brain|memory|chromadb|aggressive` deep link safely.
 *
 * The Aggressive Hub surface (section + /api/memory/aggressive route + helpers)
 * was removed here too; the aggressive_mode DB tables/columns are preserved and
 * HUB_AGGRESSIVE_TOGGLE_ENABLED is tombstoned (=false), never dropped.
 */

interface MemoryZoneViewProps {
  subtab: string;
}

export function MemoryZoneView({ subtab }: MemoryZoneViewProps) {
  switch (subtab) {
    case "intel":
    default:
      return (
        <div className="mx-auto w-full max-w-screen-2xl">
          <MemoryIntelSection />
        </div>
      );
  }
}
