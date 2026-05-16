"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { TabBar, type TabBarItem } from "@/components/ui";
import { DownloadsSection } from "@/components/docs/downloads-section";
import { LessonsSection } from "@/components/docs/lessons-section";
import { JournalSection } from "@/components/docs/journal-section";

/**
 * /docs zone view — Downloads / Lessons / Journal.
 *
 * Wave D2 migrated these three sections here from /intel. The tab strip is
 * rendered locally with the shared `TabBar` primitive rather than the global
 * AppShell ZoneSubTabs, because /docs is not yet a registered zone in
 * navigation.ts — the DOCS nav slot lands in Wave D3.
 */

type DocsTab = "downloads" | "lessons" | "journal";

const DOCS_TABS: ReadonlyArray<TabBarItem<DocsTab>> = [
  { key: "downloads", label: "Downloads" },
  { key: "lessons", label: "Lessons" },
  { key: "journal", label: "Journal" },
];

function DocsPanel({ tab }: { tab: DocsTab }) {
  switch (tab) {
    case "downloads":
      return <DownloadsSection />;
    case "lessons":
      return <LessonsSection />;
    case "journal":
      return <JournalSection />;
    default:
      return <DownloadsSection />;
  }
}

interface DocsZoneViewProps {
  subtab: string;
}

export function DocsZoneView({ subtab }: DocsZoneViewProps) {
  const router = useRouter();
  const active: DocsTab =
    subtab === "lessons" || subtab === "journal" ? subtab : "downloads";

  return (
    <div className="font-mono">
      <header className="px-4 pt-4">
        <h1 className="text-h2 text-fg-primary">DOCS</h1>
        <p className="mt-1 text-caption text-fg-muted">
          Reports · Lessons · Journal
        </p>
      </header>
      <div className="sticky top-0 z-20 mt-3 bg-bg-sidebar/95 px-4 backdrop-blur">
        <TabBar
          items={DOCS_TABS}
          active={active}
          onChange={(next) => router.push(`/docs?tab=${next}`)}
        />
      </div>
      <DocsPanel tab={active} />
    </div>
  );
}
