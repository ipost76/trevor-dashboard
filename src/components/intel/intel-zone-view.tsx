"use client";
import * as React from "react";
import { SimilarTradesSection } from "./similar-trades-section";
import { CalibrationSection } from "./calibration-section";
import { ShadowSection } from "./shadow-section";

/**
 * /intel zone view — Similar / Calibration / Shadow.
 *
 * Wave D2 moved Downloads / Lessons / Journal out to /docs; this dispatcher
 * now handles only the three analysis tabs that remain on /intel.
 */

interface IntelZoneViewProps {
  subtab: string;
}

export function IntelZoneView({ subtab }: IntelZoneViewProps) {
  switch (subtab) {
    case "calibration":
      return <CalibrationSection />;
    case "shadow":
      return <ShadowSection />;
    case "similar":
    default:
      return <SimilarTradesSection />;
  }
}
