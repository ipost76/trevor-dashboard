"use client";

import { Suspense, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TabBar } from "@/components/ui";
import { PositionSignalsPanel } from "./position-signals-panel";
import { SwingSignalsPanel } from "./swing-signals-panel";
import { WatchlistTable } from "./watchlist-table";
import { ConfigPanel } from "./config-panel";
import { FilingsStream } from "./filings-stream";
import { InsiderHeatmap } from "./insider-heatmap";
import { SectorRotation } from "./sector-rotation";
import { PerformanceTracker } from "./performance-tracker";

const TABS = [
  { key: "signals" as const, label: "Signals" },
  { key: "watchlist" as const, label: "Watchlist" },
  { key: "filings" as const, label: "Filings" },
  { key: "insiders" as const, label: "Insiders" },
  { key: "sectors" as const, label: "Sectors" },
  { key: "performance" as const, label: "Performance" },
  { key: "config" as const, label: "Config" },
];

type TabKey = (typeof TABS)[number]["key"];
const VALID_KEYS = new Set<TabKey>(TABS.map((t) => t.key));
const DEFAULT_TAB: TabKey = "signals";

function ScoutTabsInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const active: TabKey =
    tabParam && VALID_KEYS.has(tabParam as TabKey) ? (tabParam as TabKey) : DEFAULT_TAB;

  const setActive = useCallback(
    (next: TabKey) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, pathname, router],
  );

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-4 p-4 md:p-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-h2 text-fg-primary">SCOUT</h1>
          <p className="text-caption text-fg-muted">
            Stock Discovery — signals · watchlist · filings · insiders · sectors · performance ·
            config
          </p>
        </div>
      </header>
      <TabBar items={TABS} active={active} onChange={setActive} />
      <div>
        {active === "signals" && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <PositionSignalsPanel />
            <SwingSignalsPanel />
          </div>
        )}
        {active === "watchlist" && <WatchlistTable />}
        {active === "filings" && <FilingsStream />}
        {active === "insiders" && <InsiderHeatmap />}
        {active === "sectors" && <SectorRotation />}
        {active === "performance" && <PerformanceTracker />}
        {active === "config" && <ConfigPanel />}
      </div>
    </div>
  );
}

export function ScoutTabs() {
  return (
    <Suspense
      fallback={<div className="p-4 text-caption text-fg-muted md:p-6">Loading…</div>}
    >
      <ScoutTabsInner />
    </Suspense>
  );
}
