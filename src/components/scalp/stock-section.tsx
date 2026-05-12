"use client";
import * as React from "react";
import { DiscoveryFeed } from "@/components/scout/discovery-feed";

/**
 * STOCK sub-tab — SCOUT discovery feed.
 *
 * Replaces the prior placeholder. Renders the discovery feed (header,
 * engine/days filters, cards) directly inside the standard Manual-zone
 * page wrapper so spacing density matches the SCALP / REMINDERS / DCA
 * siblings.
 */
export function StockSection() {
  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <DiscoveryFeed />
    </div>
  );
}
