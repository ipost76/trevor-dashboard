"use client";
import * as React from "react";
import { LiveBoardSection } from "./live-board-section";
import { RecentSignalsSection } from "./recent-signals-section";
import { QualitySection } from "./quality-section";
import { CalibrationSection } from "./calibration-section";

interface ScalpZoneViewProps {
  subtab: string;
}

export function ScalpZoneView({ subtab }: ScalpZoneViewProps) {
  switch (subtab) {
    case "recent":
      return <RecentSignalsSection />;
    case "quality":
      return <QualitySection />;
    case "calibration":
      return <CalibrationSection />;
    case "live-board":
    default:
      return <LiveBoardSection />;
  }
}
