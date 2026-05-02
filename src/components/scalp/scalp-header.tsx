"use client";
import * as React from "react";
import { Card, LivePulse, KillswitchPill } from "@/components/ui";
import { Activity } from "lucide-react";

/**
 * MANUAL zone system header.
 *
 * Mirrors the AUTO page's ScalperHeader pattern: Card with zone-accent glow
 * (magenta — violet maps to magenta-glow per accentGlowClass()) + zone icon
 * + system title + subtitle metadata + LIVE pulse + KillswitchPill mirror.
 *
 * SCALP zone is display + manual-entry only — no LIVE/PAPER/DISABLED state.
 * The pulse stays cyan-LIVE; the KillswitchPill conveys project-wide pause
 * state (amber STANDBY when on, hidden otherwise).
 */
export function ScalpHeader() {
  return (
    <Card padding="md" glow="magenta">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Activity size={18} className="text-accent-magenta" aria-hidden />
          <div className="flex flex-col">
            <span className="text-h3 font-bold tracking-wide">SCALP TRADING</span>
            <span className="text-micro text-fg-muted">
              Manual Signals · 5 tickers
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LivePulse tone="cyan" label="LIVE" />
          <KillswitchPill />
        </div>
      </div>
    </Card>
  );
}
