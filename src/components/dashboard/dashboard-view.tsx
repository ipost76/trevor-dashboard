"use client";
import * as React from "react";
import { HeroPnLCard } from "./hero-pnl-card";
import { ActivePositionsCard } from "./active-positions-card";

/**
 * Post-redesign Dashboard composition.
 * C1 (2026-04-29): hero PnL card + active positions card.
 * C2 will add Edge Analysis + Quick Stats + Calibration tile here.
 */
export function DashboardView() {
  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8">
      <HeroPnLCard />
      <ActivePositionsCard />
      {/* C2 inserts Edge Analysis + Quick Stats + Calibration here */}
    </div>
  );
}
