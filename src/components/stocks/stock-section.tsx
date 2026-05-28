import * as React from "react";
import { Card } from "@/components/ui";

/**
 * STOCK sub-tab — "Coming Soon" placeholder.
 *
 * SCOUT (the stock-scanner backend) was permanently removed 2026-05-28
 * (SCOUT-REMOVE wave). The discovery-feed components + the SCOUT_V3_FEED
 * flag-read are gone. This placeholder occupies the STOCK sub-tab so the
 * 502 error from the dead SCOUT API stops surfacing in the UI.
 *
 * Composes cleanly with the parent HUB_REDESIGN_SCALP gate at /stocks/page.tsx:
 *   HUB_REDESIGN_SCALP=true   → this placeholder renders
 *   HUB_REDESIGN_SCALP=false  → StocksDisabled (zone gated off)
 *
 * The DCA sub-tab is unaffected and remains live (see dca-section.tsx).
 */
export function StockSection() {
  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <Card padding="lg" className="card-elevated">
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
          <div className="text-micro uppercase tracking-[0.3em] text-accent-plum/80">
            STOCK SCANNER
          </div>
          <h2 className="font-sans text-h2 font-semibold tracking-tight text-fg-primary">
            Coming Soon
          </h2>
          <p className="max-w-sm font-sans text-caption leading-relaxed text-fg-muted">
            Automated stock research and signal generation is currently paused.
            Crypto AutoTrader, DCA reminders, and all other TREVOR features
            remain fully operational.
          </p>
        </div>
      </Card>
    </div>
  );
}
