"use client";
import * as React from "react";
import { HeroPnLCard } from "./hero-pnl-card";
import { ActivePositionsCard } from "./active-positions-card";
import { QuickStatsStrip } from "./quick-stats-strip";
import { EdgeAnalysisCard } from "./edge-analysis-card";
import { CalibrationQuickTile } from "./calibration-quick-tile";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";

/**
 * Post-redesign Dashboard composition.
 * C1: HeroPnLCard + ActivePositionsCard.
 * C2: + QuickStatsStrip + EdgeAnalysisCard + CalibrationQuickTile + pull-to-refresh.
 *
 * Order LOCKED: Hero -> Active -> Quick Stats -> Edge -> Calibration.
 * Pull-to-refresh re-mounts every child via key bump, causing each to refetch.
 */
export function DashboardView() {
  const [refreshKey, setRefreshKey] = React.useState(0);

  const { pullDistance, isRefreshing } = usePullToRefresh({
    onRefresh: async () => {
      setRefreshKey((k) => k + 1);
      await new Promise((r) => setTimeout(r, 600));
    },
    threshold: 64,
  });

  return (
    <div className="relative">
      {(pullDistance > 0 || isRefreshing) && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-center pt-2 lg:hidden"
          style={{ transform: `translateY(${Math.min(pullDistance - 32, 32)}px)` }}
        >
          <div
            className={`text-micro text-accent-cyan transition-opacity duration-fast ${
              isRefreshing ? "animate-pulse opacity-100" : "opacity-70"
            }`}
          >
            {isRefreshing
              ? "Refreshing…"
              : pullDistance >= 64
              ? "Release to refresh"
              : "Pull to refresh"}
          </div>
        </div>
      )}

      <div
        key={refreshKey}
        className="space-y-4 p-4 animate-fade-in md:space-y-6 md:p-6 lg:px-8"
      >
        <HeroPnLCard />
        <ActivePositionsCard />
        <QuickStatsStrip />
        <EdgeAnalysisCard />
        <CalibrationQuickTile />
      </div>
    </div>
  );
}
