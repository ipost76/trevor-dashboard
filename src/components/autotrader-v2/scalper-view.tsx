"use client";
import * as React from "react";
import { ScalperHeader } from "./scalper-header";
import { CapitalHero } from "./capital-hero";
import { ActivePositionCard } from "./active-position-card";
import { RecentTradesCard } from "./recent-trades-card";
import { ConfigCard } from "./config-card";
import { WatchlistGrid } from "./watchlist-grid";
import { DegenSection } from "./degen-section";

interface ScalperViewProps {
  subtab?: string;
}

export function ScalperViewV2({ subtab = "scalper" }: ScalperViewProps) {
  if (subtab === "degen") {
    return (
      <div className="flex flex-col gap-4 px-3 sm:px-4 pt-4 pb-8 animate-fade-in">
        <DegenSection />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <ScalperHeader />
      <CapitalHero />
      <ActivePositionCard />
      <RecentTradesCard />
      <ConfigCard />
      <WatchlistGrid />
    </div>
  );
}
