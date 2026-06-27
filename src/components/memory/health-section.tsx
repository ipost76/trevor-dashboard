"use client";
import * as React from "react";
import { CollapsibleSection, Pill } from "@/components/ui";
import { HealthRollup } from "./health-rollup";
import { AiFindingsPanel } from "./ai-findings-panel";
import { KillswitchControlCard } from "./killswitch-control-card";
import { DataFreshnessCard } from "./data-freshness-card";
import { ReconcileHealthCard } from "./reconcile-health-card";
import { ShadowLabCard } from "./shadow-lab-card";
import { HeartbeatView } from "./heartbeat-view";
import { SentinelsCard } from "./sentinels-card";

// HB-04 (2026-05-12): MEMORY → System Health rewritten as a composite of
// three independent cards:
//
//   1. <KillswitchControlCard /> — PRESERVED. The Hub-Only Control Doctrine
//      single write surface for EMERGENCY_KILLSWITCH (Rule 32, codified
//      2026-05-02). Moving or deleting this would re-orphan the killswitch.
//   2. <HeartbeatView /> — NEW. Polls /api/heartbeat → Observatory aiohttp
//      (tailnet :8443 on the new box, per OBS-REPOINT — not the dead :3335);
//      6-card status grid + active-issues strip +
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
// B6 P4 (2026-06-21): <ShadowLabCard> (after Reconcile) surfaces the B6 unified
// shadow registry (registered_shadows[] off /api/shadow/registry) — read-only,
// no promote button. EmptyState until B7 registers ssl.py.
//
// B4 AI engine P4 (2026-06-21): <AiFindingsPanel> mounted at the TOP (above
// Killswitch) — the AI Analysis findings list + "Analyze now" button. This is
// the default "health" sub-tab; the sibling "docs" sub-tab (/health?tab=docs)
// renders <AiDocsFeed> from the page dispatcher. The ShadowLabCard + every other
// card below stay exactly as-is.
//
// B7 (2026-06-22): HEALTH page redesign — glanceable hierarchy. <HealthRollup>
// is the new TOP-OF-PAGE green/amber/red glance pill (worst-of heartbeat
// overall_status + max AI-finding severity; reuses /api/heartbeat +
// /api/health/ai-findings, no new route). <AiFindingsPanel> is the AI hero,
// kept directly under the rollup (first/dominant card by position + its existing
// cyan border-l-4 accent). The 6 system/infra cards below are unchanged here —
// their dedupe/grouping is B8's scope (incl. heartbeat-view.tsx internals).
//
// B8 (2026-06-22): lower-card cleanup — the 3 data cards (DataFreshness +
// Reconcile + ShadowLab) are folded into a collapsed "Data Integrity"
// <CollapsibleSection> so the page is short by default; HeartbeatView's
// internals (Budget dedupe, System regroup, collapsible groups) + the
// killswitch help collapse live in their own files. B7's HealthRollup +
// AiFindingsPanel (top) are untouched here.
//
// Page-padding wrapper (`space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8`) +
// `animate-fade-in` retained from the G2 version. MemoryZoneView's
// `mx-auto w-full max-w-screen-2xl` outer wrap (G2 centering fix) still
// applies because that's a sibling wrapper at the dispatcher level.

export function HealthSection() {
  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <HealthRollup />
      <AiFindingsPanel />
      <KillswitchControlCard />
      {/* B8: lower-card region — Data Integrity group (collapsed by default) */}
      <CollapsibleSection
        title="Data Integrity"
        defaultOpen={false}
        rightSlot={
          <Pill tone="neutral" size="sm">
            freshness · reconcile · shadows
          </Pill>
        }
      >
        <div className="space-y-4 p-4">
          <DataFreshnessCard />
          <ReconcileHealthCard />
          <ShadowLabCard />
        </div>
      </CollapsibleSection>
      <HeartbeatView />
      <SentinelsCard />
    </div>
  );
}
