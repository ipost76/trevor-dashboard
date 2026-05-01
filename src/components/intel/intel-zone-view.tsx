"use client";
import * as React from "react";
import { LessonsSection } from "./lessons-section";
import { JournalSection } from "./journal-section";
import { SimilarTradesSection } from "./similar-trades-section";
import { CalibrationSection } from "./calibration-section";
import { ShadowSection } from "./shadow-section";

interface IntelZoneViewProps {
  subtab: string;
}

export function IntelZoneView({ subtab }: IntelZoneViewProps) {
  switch (subtab) {
    case "lessons":
      return <LessonsSection />;
    case "journal":
      return <JournalSection />;
    case "similar":
      return <SimilarTradesSection />;
    case "calibration":
      return <CalibrationSection />;
    case "shadow":
      return <ShadowSection />;
    default:
      return <LessonsSection />;
  }
}
