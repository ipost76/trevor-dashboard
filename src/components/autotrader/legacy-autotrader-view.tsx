"use client";

import { useEffect, useState } from "react";
import AutoTraderPage from "@/components/autotrader/AutoTraderPage";
import { BotSectionHeader } from "@/components/autotrader/BotSectionHeader";
import { DegenSection } from "@/components/autotrader/DegenSection";
import {
  DEGEN_CONFIG,
  SCALPER_CONFIG,
  type BotMode,
} from "@/lib/bots";

// Legacy fallback rendering for /autotrader when HUB_REDESIGN_AUTO=false.
// Preserves the pre-D1 layout (sticky title + SCALPER + DEGEN sections)
// MINUS BotNavStrip — B1's ZoneSubTabs handles sub-tab nav now and the
// BotNavStrip file is deleted in D1 §7.3. Sections stack vertically.

function useScalperMode(): BotMode {
  const [mode, setMode] = useState<BotMode>(SCALPER_CONFIG.mode);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/auto-trader/config");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          ok: boolean;
          config?: Record<string, string>;
        };
        const flag = (data?.config?.AUTO_LIVE_ENABLED ?? "false").toLowerCase();
        if (!cancelled) setMode(flag === "true" ? "live" : "paper");
      } catch {
        /* swallow — falls back to default */
      }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return mode;
}

export function LegacyAutotraderView() {
  const scalperMode = useScalperMode();

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div
        className="shrink-0"
        style={{
          fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
          fontSize: 16,
          fontWeight: 700,
          color: "#00ff88",
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          padding: "16px 20px 12px",
          borderBottom: "1px solid rgba(0,255,136,0.18)",
          background: "var(--sidebar, #080d09)",
        }}
      >
        AUTO TRADER
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <section
          id={SCALPER_CONFIG.scrollAnchorId}
          className="flex flex-col gap-4 px-3 sm:px-4 pt-4 pb-6"
          aria-label="Scalper bot"
        >
          <BotSectionHeader bot={SCALPER_CONFIG} dynamicMode={scalperMode} />
          <AutoTraderPage />
        </section>

        <section
          id={DEGEN_CONFIG.scrollAnchorId}
          className="flex flex-col gap-4 px-3 sm:px-4 pt-2 pb-8"
          aria-label="Degen bot"
        >
          <DegenSection />
        </section>
      </div>
    </div>
  );
}
