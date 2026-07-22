import * as React from "react";
import { ShadowOverview } from "@/components/intel/shadow-overview";
import { MemoryLivenessLine } from "./memory-liveness-line";
import { TrainerSearchSection } from "./trainer-search-section";
import { TrainerReasoningSection } from "./trainer-reasoning-section";
import { PromotionCandidatesList } from "./promotion-candidates-list";
import { CapabilityQueueSection } from "./capability-queue-section";
import { TrainerPauseControl } from "./trainer-pause-control";
import { ZoneEyebrow } from "@/components/zone-eyebrow";

/**
 * TRAINER page dispatcher (R12-B1). Rendered by /intel when HUB_REDESIGN_TRAINER
 * is ON. The R11 liveness LINE (decision 7) sits at the top of EVERY sub-tab;
 * the `?tab=` switch matches the existing IntelZoneView pattern (the visible
 * strip is B3's navigation.ts job — every tab is reachable via ?tab= now).
 *
 * Sub-tabs: search · reasoning · shadows · promotions · capability. The `shadows`
 * tab reuses the existing <ShadowOverview/> BYTE-IDENTICAL (it owns its own
 * full-page layout, so the liveness line rides above it without double-padding).
 * A stale/unknown tab (incl. the legacy `shadow`) falls through to `search`.
 */
export function TrainerZoneView({ subtab }: { subtab: string }) {
  // The shadows tab reuses <ShadowOverview/>, which owns its own page padding —
  // render the liveness line in a matching strip above it, then the component.
  if (subtab === "shadows" || subtab === "shadow") {
    return (
      <div className="animate-fade-in">
        <div className="px-4 pt-4 md:px-6 lg:px-8">
          <MemoryLivenessLine />
        </div>
        <ShadowOverview />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <ZoneEyebrow zone="trainer" />
      <MemoryLivenessLine />
      {/* R12-B3: the trainer pause control — renders NOTHING until
          HUB_PAUSE_CONTROL_ENABLED is on (default OFF), so this is inert today. */}
      <TrainerPauseControl />
      {subtab === "reasoning" ? (
        <TrainerReasoningSection />
      ) : subtab === "promotions" ? (
        <PromotionCandidatesList />
      ) : subtab === "capability" ? (
        <CapabilityQueueSection />
      ) : (
        <TrainerSearchSection />
      )}
    </div>
  );
}
