"use client";
import * as React from "react";
import { ScalpHeader } from "./scalp-header";
import { LiveBoardSection } from "./live-board-section";
import { RecentSignalsSection } from "./recent-signals-section";
import { QualitySection } from "./quality-section";
import { CalibrationSection } from "./calibration-section";
import { DCASection } from "./dca-section";

interface ScalpZoneViewProps {
  subtab?: string;
  /**
   * Pre-rendered StockSection server component, passed in from the parent
   * page (/manual/page.tsx) so the SCOUT_V3_FEED flag-read (which uses
   * server-only `next/headers`) can compose correctly with this client
   * dispatcher. Rendered when subtab === "stock".
   */
  stockSlot?: React.ReactNode;
}

const PAGE_WRAPPER =
  "space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in";

/**
 * MANUAL zone — host page for manual systems.
 *
 * Sub-tab strip (Scalp / Stock / Reminders / DCA) is rendered by
 * <ZoneSubTabs /> at the AppShell level (URL-synced via `?tab=`),
 * pixel-identical to the AUTO page's SCALPER / DEGEN strip. Default
 * tab is "scalp".
 *
 * SCALP composition mirrors AUTO's ScalperViewV2 stacked-Card pattern:
 * ScalpHeader + LiveBoard + Recent + Quality + Calibration. Reset buttons
 * live inside CalibrationSection via <ResetControlsCard />.
 *
 * STOCK self-wraps its own outer padding container (placeholder).
 *
 * DCA emits a fragment — wrapped here in the standard page-padding
 * container so spacing matches SCALP. (Reminders sub-tab was removed
 * 2026-05-14; reminders back the DCA cadence as a mechanism, not a
 * standalone view. `?tab=reminders` URLs are redirected to
 * `?tab=dca` at the page level — see /manual/page.tsx.)
 */
export function ScalpZoneView({ subtab = "scalp", stockSlot }: ScalpZoneViewProps) {
  if (subtab === "stock") {
    return <>{stockSlot}</>;
  }

  if (subtab === "dca") {
    return (
      <div className={PAGE_WRAPPER}>
        <DCASection />
      </div>
    );
  }

  return (
    <div className={PAGE_WRAPPER}>
      <ScalpHeader />
      <LiveBoardSection />
      <RecentSignalsSection />
      <QualitySection />
      <CalibrationSection />
    </div>
  );
}
