"use client";
import * as React from "react";
import { NotesSection } from "./notes-section";
import { ShadowOverview } from "./shadow-overview";
import { ShadowCompareSection } from "./shadow-compare-section";
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
 * client-side notepad with no backend. The orphan Python helpers
 * `query_similar_trades.py` + `query_calibration_deep.py` (Hub-repo root) were
 * deleted in QUAL-05 (2026-06-03), the cross-repo cleanup that simultaneously
 * pruned both names from the bot's `monitor_center/monitors/11_hub_api.py`
 * `TRACKED_HELPERS` list so the missing-tracked-helper CRIT never fires.
 * (The `dashboard/calibration` orphan route stays — it's still in the bot's
 * `PROBE_ROUTES`, so removing it needs a paired PROBE_ROUTES prune.)
 * Notes is the default tab.
 *
 * Wave D4 (2026-05-27): SHADOW sub-tab swapped from the long-scroll
 * `ShadowSection` to the compact `ShadowOverview` (Active/Dormant tabs +
 * function sub-sections + ShadowScoring hero). Old `shadow-section.tsx` and
 * `shadow-table-card.tsx` left on disk for a separate cleanup prompt.
 */

interface IntelZoneViewProps {
  subtab: string;
}

export function IntelZoneView({ subtab }: IntelZoneViewProps) {
  switch (subtab) {
    case "shadow":
      return <ShadowOverview />;
    case "promote":
      return <ShadowCompareSection />;
    case "lessons":
      return <LessonsSection />;
    case "journal":
      return <JournalSection />;
    case "notes":
    default:
      return <NotesSection />;
  }
}
