"use client";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { VaultTab } from "@/components/ghost/vault-tab";
import { TradesTab } from "@/components/ghost/trades-tab";
import { StrategiesTab } from "@/components/ghost/strategies-tab";
import { NotesTab } from "@/components/ghost/notes-tab";

const TABS = ["Vault", "Trades", "Strategies", "Notes"] as const;
type TabName = (typeof TABS)[number];

export default function GhostHQPanel() {
  const [tab, setTab] = useState<TabName>("Vault");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => {
      setCanScrollLeft(el.scrollLeft > 2);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", check); ro.disconnect(); };
  }, []);

  return (
    <div className="min-h-screen p-4 md:p-6 flex flex-col gap-4">
      <h1 className="text-lg font-bold tracking-[0.2em] uppercase neon-text shrink-0">Ghost Command Center</h1>

      {/* Tab bar */}
      <div className="relative shrink-0 sticky top-0 z-[19] bg-[var(--bg-deep,#0a0a0f)]">
        <div ref={scrollRef} className="flex gap-1 overflow-x-auto pb-1 border-b border-[rgba(0,240,255,0.1)] scrollbar-hide">
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
        {canScrollRight && (
          <div className="absolute top-0 right-0 bottom-0 w-10 pointer-events-none bg-gradient-to-l from-[var(--bg-deep,#0a0a0f)] to-transparent transition-opacity" />
        )}
        {canScrollLeft && (
          <div className="absolute top-0 left-0 bottom-0 w-10 pointer-events-none bg-gradient-to-r from-[var(--bg-deep,#0a0a0f)] to-transparent z-[1] transition-opacity" />
        )}
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
