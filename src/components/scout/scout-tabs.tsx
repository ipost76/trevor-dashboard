"use client";

import { useState } from "react";
import { TabBar } from "@/components/ui";
import { PositionSignalsPanel } from "./position-signals-panel";
import { SwingSignalsPanel } from "./swing-signals-panel";
import { WatchlistTable } from "./watchlist-table";
import { ConfigPanel } from "./config-panel";

type TabKey = "signals" | "watchlist" | "config";

const TABS = [
  { key: "signals" as const, label: "Signals" },
  { key: "watchlist" as const, label: "Watchlist" },
  { key: "config" as const, label: "Config" },
];

export function ScoutTabs() {
  const [active, setActive] = useState<TabKey>("signals");
  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-4 p-4 md:p-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-h2 text-fg-primary">SCOUT</h1>
          <p className="text-caption text-fg-muted">
            Stock Discovery — Engine A · Engine B · Watchlist · Config
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
        {active === "config" && <ConfigPanel />}
      </div>
    </div>
  );
}
