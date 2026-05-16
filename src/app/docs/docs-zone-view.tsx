"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { TabBar, type TabBarItem } from "@/components/ui";

/**
 * Wave D1 — placeholder /docs zone view.
 *
 * Downloads / Lessons / Journal migrate here from /intel in Wave D2; until
 * then each tab renders a migration placeholder. The tab strip is rendered
 * locally with the shared `TabBar` primitive (the same component /intel's
 * strip uses via ZoneSubTabs) rather than the global AppShell ZoneSubTabs,
 * because /docs is intentionally not yet a registered zone in navigation.ts —
 * the DOCS nav slot lands in Wave D3.
 */

type DocsTab = "downloads" | "lessons" | "journal";

const DOCS_TABS: ReadonlyArray<TabBarItem<DocsTab>> = [
  { key: "downloads", label: "Downloads" },
  { key: "lessons", label: "Lessons" },
  { key: "journal", label: "Journal" },
];

function MigrationPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-8 text-center font-mono">
      <div className="text-micro uppercase tracking-[0.3em] text-accent-cyan/60">
        {label}
      </div>
      <h2 className="text-h2 text-fg-primary">Migrating in Wave D2</h2>
      <p className="max-w-md text-caption text-fg-muted">
        Content coming soon — this section moves here from{" "}
        <code className="rounded bg-bg-elevated px-2 py-0.5 text-accent-cyan">
          /intel
        </code>{" "}
        in Wave D2.
      </p>
    </div>
  );
}

/** D1 placeholder dispatcher — Wave D2 swaps each case for the real section. */
function DocsPanel({ tab }: { tab: DocsTab }) {
  switch (tab) {
    case "downloads":
      return <MigrationPlaceholder label="DOWNLOADS" />;
    case "lessons":
      return <MigrationPlaceholder label="LESSONS" />;
    case "journal":
      return <MigrationPlaceholder label="JOURNAL" />;
    default:
      return <MigrationPlaceholder label="DOWNLOADS" />;
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
