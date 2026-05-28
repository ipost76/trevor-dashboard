"use client";
import * as React from "react";
import { DCASection } from "./dca-section";

interface StocksZoneViewProps {
  subtab?: string;
  /**
   * Pre-rendered StockSection component, passed in from the parent page
   * (/stocks/page.tsx). Rendered when subtab === "stock" (the default).
   * Post-SCOUT-REMOVE (2026-05-28) StockSection is a "Coming Soon"
   * placeholder — no server-only flag read remains, but the slot pattern
   * is preserved so future stock surfaces drop in cleanly.
   */
  stockSlot?: React.ReactNode;
}

const PAGE_WRAPPER =
  "space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in";

/**
 * STOCKS zone — host page for the Stock + DCA manual surfaces.
 *
 * Sub-tab strip (Stock / DCA) is rendered by <ZoneSubTabs /> at the
 * AppShell level (URL-synced via `?tab=`). Default tab is "stock".
 *
 * STOCK is passed in as the `stockSlot` prop and self-wraps its own outer
 * padding container.
 *
 * DCA emits a fragment — wrapped here in the standard page-padding
 * container. The legacy `?tab=reminders` URL is redirected to `?tab=dca`
 * at the page level — see /stocks/page.tsx.
 *
 * History:
 * - SCALP sub-tab + its sections were removed in Wave C2 (2026-05-16);
 *   the dispatcher now routes Stock | DCA only.
 * - SCOUT discovery-feed backend permanently removed 2026-05-28; the
 *   STOCK sub-tab now renders a "Coming Soon" placeholder. DCA is
 *   unaffected (always was independent of SCOUT).
 */
export function StocksZoneView({ subtab = "stock", stockSlot }: StocksZoneViewProps) {
  if (subtab === "dca") {
    return (
      <div className={PAGE_WRAPPER}>
        <DCASection />
      </div>
    );
  }

  return <>{stockSlot}</>;
}
