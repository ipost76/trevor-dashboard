"use client";
import * as React from "react";
import { ShadowOverview } from "./shadow-overview";
import { LessonsSection } from "@/components/docs/lessons-section";
import { JournalSection } from "@/components/docs/journal-section";

/**
 * /intel zone view — Shadow / Lessons / Journal.
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
    // RM-DECOM B5 (2026-07-08): the "Promote" tab was removed (a single-component
    // Wilson-LB approximation presented as a promotion verdict; no promote action
    // exists). H1 (2026-07-09): the "Impact" ($-rank, <ShadowRankSection>) and
    // "Daily Edge" (<DailyEdgeSection>) tabs were removed — they were the display
    // layer of the promotion/edge apparatus RM-DECOM decommissioned; Ghost now
    // drives all edge/tweak analysis through CC recon. Their component files are
    // deleted; IMPACT's shared /api/shadow/registry route stays (SHADOW + Health
    // depend on it). A stale ?tab=promote|impact|daily-edge deep link falls
    // through to Shadow.
    case "lessons":
      return <LessonsSection />;
    case "journal":
      return <JournalSection />;
    default:
      return <ShadowOverview />;
  }
}
