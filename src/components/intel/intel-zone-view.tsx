"use client";
import * as React from "react";
import { NotesSection } from "./notes-section";
import { ShadowSection } from "./shadow-section";
import { LessonsSection } from "@/components/docs/lessons-section";
import { JournalSection } from "@/components/docs/journal-section";

/**
 * /intel zone view — Notes / Shadow / Lessons / Journal.
 *
 * Wave D2 moved Lessons / Journal out to /docs; a 2026-05-19 follow-up brought
 * them back to /intel (Downloads stays on /docs as the sole surface, now with
 * category tabs). Component source files for Lessons / Journal remain under
 * `components/docs/` — only the dispatcher routing changed. The Similar +
 * Calibration tabs were removed 2026-05-20 and replaced by Notes — a
 * client-side notepad with no backend. Orphan Python helpers
 * `query_similar_trades.py` + `query_calibration_deep.py` remain in the Hub
 * repo at `/home/trevor/trevor-dashboard/query_*.py` (they were never under
 * `/home/trevor/trevor/`) — they stay on disk because the bot's
 * `monitor_center/monitors/11_hub_api.py` `TRACKED_HELPERS` list would emit
 * CRIT alerts on their deletion, and pruning that list requires touching
 * `/home/trevor/trevor/`, forbidden from a Hub prompt. Matches the
 * `dashboard/calibration` orphan pattern. Notes is the default tab.
 */

interface IntelZoneViewProps {
  subtab: string;
}

export function IntelZoneView({ subtab }: IntelZoneViewProps) {
  switch (subtab) {
    case "shadow":
      return <ShadowSection />;
    case "lessons":
      return <LessonsSection />;
    case "journal":
      return <JournalSection />;
    case "notes":
    default:
      return <NotesSection />;
  }
}
