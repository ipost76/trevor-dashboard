"use client";
import * as React from "react";
import { ScalperHeader } from "./scalper-header";
import { CapitalHero } from "./capital-hero";
import { ActivePositionCard } from "./active-position-card";
import { ProfitRiskPanel } from "./profit-risk-panel";
import { WatchlistGrid } from "./watchlist-grid";

export function DashboardTab() {
  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <ScalperHeader />
      <CapitalHero />
      <ActivePositionCard />
      <ProfitRiskPanel />
      <WatchlistGrid />
    </div>
  );
}
