"use client";
import * as React from "react";
import { DCASection } from "./dca-section";

interface StocksZoneViewProps {
  subtab?: string;
  /**
   * Pre-rendered StockSection server component, passed in from the parent
   * page (/stocks/page.tsx) so the SCOUT_V3_FEED flag-read (which uses
   * server-only `next/headers`) can compose correctly with this client
   * dispatcher. Rendered when subtab === "stock" (the default).
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
 * STOCK is passed in as the `stockSlot` server-component prop (it reads
 * the SCOUT_V3_FEED flag via server-only `next/headers`) — see
 * /stocks/page.tsx. It self-wraps its own outer padding container.
 *
 * DCA emits a fragment — wrapped here in the standard page-padding
 * container. The legacy `?tab=reminders` URL is redirected to `?tab=dca`
 * at the page level — see /stocks/page.tsx.
 *
 * SCALP sub-tab + its sections were removed in Wave C2 (2026-05-16); the
 * dispatcher now routes Stock | DCA only.
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
