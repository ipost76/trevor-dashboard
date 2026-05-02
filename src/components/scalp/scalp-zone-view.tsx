"use client";
import * as React from "react";
import { CollapsibleSection } from "@/components/ui";
import { LiveBoardSection } from "./live-board-section";
import { RecentSignalsSection } from "./recent-signals-section";
import { QualitySection } from "./quality-section";
import { CalibrationSection } from "./calibration-section";

/**
 * MANUAL zone — single composition page.
 *
 * Houses the existing Live Board / Recent Signals / Quality / Calibration
 * sections (formerly four sub-tabs) inside one collapsible "SCALP TRADING"
 * section. Manual systems are systems that display information but never
 * trade autonomously. Future manual sections (e.g. DEGEN signals,
 * sentiment scanner) stack below as additional <CollapsibleSection>s.
 *
 * Calibration section already mounts <ResetControlsCard /> internally —
 * preserved automatically.
 */
export function ScalpZoneView() {
  return (
    <div className="space-y-4 p-4 animate-fade-in md:space-y-6 md:p-6 lg:px-8">
      <CollapsibleSection title="Scalp Trading" defaultOpen>
        <div className="space-y-4 md:space-y-6">
          <LiveBoardSection />
          <RecentSignalsSection />
          <QualitySection />
          <CalibrationSection />
        </div>
      </CollapsibleSection>
      {/* Future manual sections go here as additional <CollapsibleSection>s. */}
    </div>
  );
}
