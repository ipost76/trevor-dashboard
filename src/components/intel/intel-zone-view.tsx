"use client";
import * as React from "react";
import { ShadowOverview } from "./shadow-overview";
import { ShadowRankSection } from "./shadow-rank-section";
import { ShadowCompareSection } from "./shadow-compare-section";
import { LessonsSection } from "@/components/docs/lessons-section";
import { JournalSection } from "@/components/docs/journal-section";
import { DailyEdgeSection } from "./daily-edge-section";

/**
 * /intel zone view — Shadow / Lessons / Journal / Promote.
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
 *
 * W1-P1 (2026-06-12): the NOTES sub-tab was removed; the notepad relocated
 * to the global bottom-right `<NotesWidget>` (replacing the old chat FAB,
 * same `trevor-hub-notes` localStorage). `notes-section.tsx` is left on disk
 * (no longer imported) for a later cleanup prompt. Shadow is now the default.
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
    case "impact":
      // E1 $-Rank Hub Intel View — every shadow sorted by its $ impact.
      return <ShadowRankSection />;
    case "promote":
      return <ShadowCompareSection />;
    case "lessons":
      return <LessonsSection />;
    case "journal":
      return <JournalSection />;
    case "daily-edge":
      // DAILY EDGE (B2) — LAST Intel sub-tab; reads /api/daily-edge (engine JSON
      // in data/) and displays today's one-tweak recommendation. Read-only.
      return <DailyEdgeSection />;
    default:
      return <ShadowOverview />;
  }
}
