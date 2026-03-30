"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { VaultTab } from "@/components/ghost/vault-tab";
import { TradesTab } from "@/components/ghost/trades-tab";
import { StrategiesTab } from "@/components/ghost/strategies-tab";
import { NotesTab } from "@/components/ghost/notes-tab";

const TABS = ["Vault", "Trades", "Strategies", "Notes"] as const;
type TabName = (typeof TABS)[number];

export default function GhostPage() {
  const [tab, setTab] = useState<TabName>("Vault");

  return (
    <div className="min-h-screen p-4 md:p-6 flex flex-col gap-4">
      <h1 className="text-lg font-bold tracking-[0.2em] uppercase neon-text shrink-0">Ghost Command Center</h1>

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto pb-1 border-b border-[rgba(0,240,255,0.1)] shrink-0">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-3 py-1.5 text-[10px] uppercase tracking-[0.1em] font-bold whitespace-nowrap rounded-t transition-colors min-h-[44px]",
              tab === t
                ? "text-[var(--neon-cyan)] border-b-2 border-[var(--neon-cyan)] bg-[rgba(0,240,255,0.06)]"
                : "text-muted-foreground hover:text-foreground hover:bg-[rgba(0,240,255,0.03)]"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        {tab === "Vault" && <VaultTab />}
        {tab === "Trades" && <TradesTab />}
        {tab === "Strategies" && <StrategiesTab />}
        {tab === "Notes" && <NotesTab />}
      </div>
    </div>
  );
}
