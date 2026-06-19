"use client";
import * as React from "react";
import { KillswitchControlCard } from "./killswitch-control-card";
import { DataFreshnessCard } from "./data-freshness-card";
import { ReconcileHealthCard } from "./reconcile-health-card";
import { HeartbeatView } from "./heartbeat-view";
import { SentinelsCard } from "./sentinels-card";

// HB-04 (2026-05-12): MEMORY → System Health rewritten as a composite of
// three independent cards:
//
//   1. <KillswitchControlCard /> — PRESERVED. The Hub-Only Control Doctrine
//      single write surface for EMERGENCY_KILLSWITCH (Rule 32, codified
//      2026-05-02). Moving or deleting this would re-orphan the killswitch.
//   2. <HeartbeatView /> — NEW. Polls /api/heartbeat → Observatory aiohttp
//      on :3335 every 30s; 6-card status grid + active-issues strip +
//      system bars + quick stats + connectivity placeholder. Replaces the
//      former Services + System Probes grids (overlap with heartbeat data;
//      heartbeat is the richer surface).
//   3. <SentinelsCard /> — PRESERVED. Same /api/memory/health endpoint
//      G2 has used since 2026-05-01; renders only the sentinels array.
//      Unique diagnostic value (last 10 WARNING+ from trevor.log tail)
//      that the heartbeat collector doesn't expose.
//
// B4 (2026-06-19): the health view is promoted to a top-level "Health" home
// (additive nav entry; /memory?tab=health deep link preserved) and gains two
// cards near the top — <DataFreshnessCard> (live-heartbeat vs lagging-replica
// open-count drift, the "2 open vs 3" home) and <ReconcileHealthCard> (the
// bot's DB↔HL reconcile status, sourced from the heartbeat `reconcile`
// category which Phase 2/VM adds; renders EmptyState gracefully until then).
//
// Page-padding wrapper (`space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8`) +
// `animate-fade-in` retained from the G2 version. MemoryZoneView's
// `mx-auto w-full max-w-screen-2xl` outer wrap (G2 centering fix) still
// applies because that's a sibling wrapper at the dispatcher level.

export function HealthSection() {
  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <KillswitchControlCard />
      <DataFreshnessCard />
      <ReconcileHealthCard />
      <HeartbeatView />
      <SentinelsCard />
    </div>
  );
}
