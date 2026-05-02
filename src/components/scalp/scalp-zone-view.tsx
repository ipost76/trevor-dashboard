"use client";
import * as React from "react";
import { ScalpHeader } from "./scalp-header";
import { LiveBoardSection } from "./live-board-section";
import { RecentSignalsSection } from "./recent-signals-section";
import { QualitySection } from "./quality-section";
import { CalibrationSection } from "./calibration-section";
import { StockSection } from "./stock-section";

interface ScalpZoneViewProps {
  subtab?: string;
}

/**
 * MANUAL zone — host page for manual systems.
 *
 * Sub-tab strip (Scalp / Stock) is rendered by <ZoneSubTabs /> at the
 * AppShell level (URL-synced via `?tab=`), pixel-identical to the AUTO
 * page's SCALPER / DEGEN strip. Default tab is "scalp".
 *
 * SCALP composition mirrors AUTO's ScalperViewV2 stacked-Card pattern:
 * ScalpHeader + LiveBoard + Recent + Quality + Calibration. Reset buttons
 * live inside CalibrationSection via <ResetControlsCard />.
 *
 * STOCK is a placeholder until real stock-trading content ships.
 */
export function ScalpZoneView({ subtab = "scalp" }: ScalpZoneViewProps) {
  if (subtab === "stock") {
    return <StockSection />;
  }

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <ScalpHeader />
      <LiveBoardSection />
      <RecentSignalsSection />
      <QualitySection />
      <CalibrationSection />
    </div>
  );
}
