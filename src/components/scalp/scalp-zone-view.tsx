"use client";
import * as React from "react";
import { ScalpHeader } from "./scalp-header";
import { LiveBoardSection } from "./live-board-section";
import { RecentSignalsSection } from "./recent-signals-section";
import { QualitySection } from "./quality-section";
import { CalibrationSection } from "./calibration-section";

/**
 * MANUAL zone — single composition page.
 *
 * Mirrors the AUTO page's ScalperViewV2 stacked-Card pattern: outer
 * page-padding wrapper + system header card + content cards stacked
 * vertically. Manual systems display information but never trade
 * autonomously. Future manual sections (DEGEN signals, sentiment scanner,
 * etc.) drop in below CalibrationSection as additional <Card>s.
 *
 * CalibrationSection mounts <ResetControlsCard /> internally — preserved.
 */
export function ScalpZoneView() {
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
