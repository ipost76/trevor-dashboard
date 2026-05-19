"use client";
import * as React from "react";
import { DownloadsSection } from "@/components/docs/downloads-section";

/**
 * /docs zone view — Downloads (single-view zone).
 *
 * Wave D2 migrated Downloads / Lessons / Journal here from /intel; a
 * 2026-05-19 follow-up moved Lessons / Journal back to /intel, leaving /docs
 * with only the Downloads file browser (which carries its own internal
 * category tabs from Wave B1). Docs no longer has zone-level sub-tabs —
 * `<ZoneSubTabs />` auto-hides on this zone because `subTabs` was dropped
 * from the docs zone entry in navigation.ts. The switch shape is retained for
 * future single-page extensions and to absorb any stale `?tab=` URL safely.
 */

interface DocsZoneViewProps {
  subtab: string;
}

export function DocsZoneView({ subtab }: DocsZoneViewProps) {
  switch (subtab) {
    case "downloads":
    default:
      return <DownloadsSection />;
  }
}
