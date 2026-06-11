"use client";
import * as React from "react";
import { Pill } from "@/components/ui";
import { ReadinessBadge } from "@/components/ui/compact-shadow-card";
import type { ShadowRegistryTable } from "./shadow-overview";

/**
 * PromotionLeaderboard — the headline of the shadow page.
 *
 * Ranks the best/nearest-ready candidates off the LIVE readiness data
 * (`promotion` + `divergence_pct` from the c38b39b payload — no new
 * computed field). Caller passes a pre-ranked, pre-sliced top-N slice;
 * this just renders it tight (one line per entry on a phone): rank ·
 * name · readiness badge · the one or two numbers that justify the rank
 * (n divergent + %-divergence).
 *
 * Honest header: when nothing is gate-ready it reads "0 gate-ready ·
 * nearest candidates:" and still lists the nearest-ranked — never empty,
 * never fabricated. `readyCount` is the live count of ACTIVE ready
 * shadows (drives the header text only).
 */
export interface PromotionLeaderboardProps {
  /** Pre-ranked (ready → accruing, then %-div desc), pre-sliced to top N. */
  candidates: ShadowRegistryTable[];
  /** Live count of ACTIVE gate-ready shadows (for the honest header). */
  readyCount: number;
}

export function PromotionLeaderboard({ candidates, readyCount }: PromotionLeaderboardProps) {
  // No divergence/readiness signal anywhere → nothing honest to rank.
  if (candidates.length === 0) return null;

  const header =
    readyCount > 0
      ? `${readyCount} gate-ready · top candidates`
      : "0 gate-ready · nearest candidates";

  return (
    <section className="card-elevated rounded-md p-3">
      <header className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span aria-hidden className="text-caption">
          🎯
        </span>
        <h2 className="font-sans text-caption font-semibold tracking-tight text-fg-primary">
          Promotion Leaderboard
        </h2>
        <Pill intent={readyCount > 0 ? "active" : "warn"} size="sm">
          {header}
        </Pill>
      </header>

      <ol className="space-y-1.5">
        {candidates.map((t, i) => (
          <li
            key={t.table_name}
            className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-card px-2.5 py-1.5"
          >
            <span className="w-4 shrink-0 text-center font-mono text-micro tabular-nums text-fg-faint">
              {i + 1}
            </span>
            <span className="truncate font-sans text-caption font-semibold text-fg-primary">
              {t.display}
            </span>
            <span className="shrink-0">
              <ReadinessBadge
                status="active"
                promotion={t.promotion}
                promotionN={t.promotion_n}
              />
            </span>
            <span className="ml-auto shrink-0 font-mono text-micro tabular-nums text-accent-gold-strong">
              n={t.divergent_n ?? 0} · {t.divergence_pct}%
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
