"use client";
import * as React from "react";
import { ScalperHeader } from "./scalper-header";
import { CapitalHero } from "./capital-hero";
import { ActivePositionCard } from "./active-position-card";
import { ConfigCard } from "./config-card";
import { WatchlistGrid } from "./watchlist-grid";
import { AutoTraderToggleCard } from "./autotrader-toggle-card";
import { ExitControlsCard } from "./exit-controls-card";
import { PartialsToggleCard } from "./partials-toggle-card";
import { PartialShadowCard } from "./partial-shadow-card";

export function DashboardTab() {
  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <ScalperHeader />
      <CapitalHero />
      <ActivePositionCard />
      <ConfigCard />
      <WatchlistGrid />
      <AutoTraderToggleCard />
      <ExitControlsCard />
      <PartialsToggleCard />
      <PartialShadowCard />
    </div>
  );
}
