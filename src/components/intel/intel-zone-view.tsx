"use client";
import * as React from "react";
import { SimilarTradesSection } from "./similar-trades-section";
import { CalibrationSection } from "./calibration-section";
import { ShadowSection } from "./shadow-section";
import { LessonsSection } from "@/components/docs/lessons-section";
import { JournalSection } from "@/components/docs/journal-section";

/**
 * /intel zone view — Similar / Calibration / Shadow / Lessons / Journal.
 *
 * Wave D2 moved Lessons / Journal out to /docs; a 2026-05-19 follow-up brought
 * them back to /intel as tabs 4 and 5 (Downloads stays on /docs as the sole
 * surface, now with category tabs). Component source files remain under
 * `components/docs/` — only the dispatcher routing changed.
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
    case "lessons":
      return <LessonsSection />;
    case "journal":
      return <JournalSection />;
    case "similar":
    default:
      return <SimilarTradesSection />;
  }
}
