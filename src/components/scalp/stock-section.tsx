"use client";
import * as React from "react";
import { Card } from "@/components/ui";
import { TrendingUp } from "lucide-react";

/**
 * STOCK sub-tab placeholder for the MANUAL zone.
 *
 * Mirrors the SCALP composition's header-card-on-top, content-card-below
 * pattern so the layout density matches when Ghost flips between tabs.
 * Real stock-trading content lands in a future prompt.
 */
export function StockSection() {
  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <Card padding="md" glow="magenta">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <TrendingUp size={18} className="text-accent-magenta" aria-hidden />
            <div className="flex flex-col">
              <span className="text-h3 font-bold tracking-wide">
                STOCK TRADING
              </span>
              <span className="text-micro text-fg-muted">
                MANUAL · COMING SOON
              </span>
            </div>
          </div>
        </div>
      </Card>

      <Card padding="lg">
        <div className="flex min-h-[20vh] flex-col items-center justify-center gap-2 text-center">
          <p className="text-body text-fg-primary">
            Stock trading section
          </p>
          <p className="text-caption text-fg-muted">coming soon</p>
        </div>
      </Card>
    </div>
  );
}
