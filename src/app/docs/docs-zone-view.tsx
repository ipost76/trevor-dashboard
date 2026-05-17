"use client";
import * as React from "react";
import { DownloadsSection } from "@/components/docs/downloads-section";
import { LessonsSection } from "@/components/docs/lessons-section";
import { JournalSection } from "@/components/docs/journal-section";

/**
 * /docs zone view — Downloads / Lessons / Journal.
 *
 * Pure sub-tab dispatcher. The tab strip is rendered by <ZoneSubTabs /> at the
 * AppShell level (URL-synced via `?tab=`), matching /intel, /stocks, /memory.
 *
 * Wave D2 migrated these three sections here from /intel; Wave D3 registered
 * `docs` as a nav zone in navigation.ts and moved the strip from a local
 * TabBar to the global ZoneSubTabs.
 */

interface DocsZoneViewProps {
  subtab: string;
}

export function DocsZoneView({ subtab }: DocsZoneViewProps) {
  switch (subtab) {
    case "lessons":
      return <LessonsSection />;
    case "journal":
      return <JournalSection />;
    case "downloads":
    default:
      return <DownloadsSection />;
  }
}
