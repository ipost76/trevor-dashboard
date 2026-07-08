"use client";
import * as React from "react";
import { Pill } from "@/components/ui";
import { ReadinessBadge } from "@/components/ui/compact-shadow-card";
import type { ShadowRegistryTable } from "./shadow-overview";

/**
 * PromotionLeaderboard — the "top divergent shadows" headline of the shadow page.
 *
 * Ranks shadows by divergence off the LIVE payload (`promotion` +
 * `divergence_pct` — no new computed field). Caller passes a pre-ranked,
 * pre-sliced top-N slice; this renders it tight (one line per entry on a
 * phone): rank · name · divergence badge · n divergent + %-divergence.
 *
 * RM-DECOM B5 (2026-07-08): relabeled from a "promotion / gate-ready"
 * leaderboard to an honest divergence ranking. The `promotion === "ready"`
 * badge is a single-component Wilson-LB significance flag, NOT the real
 * 7-component promotion gate, and no promote action exists — so this surface
 * no longer claims "gate-ready" and the readyCount header was dropped. The
 * component name is kept internal to avoid churn across the shadow surfaces.
 */
export interface PromotionLeaderboardProps {
  /** Pre-ranked (significant divergence first, then %-div desc), sliced to top N. */
  candidates: ShadowRegistryTable[];
}

export function PromotionLeaderboard({ candidates }: PromotionLeaderboardProps) {
  // No divergence signal anywhere → nothing to rank.
  if (candidates.length === 0) return null;

  return (
    <section className="card-elevated rounded-md p-3">
      <header className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span aria-hidden className="text-caption">
          🎯
        </span>
        <h2 className="font-sans text-caption font-semibold tracking-tight text-fg-primary">
          Top Divergent Shadows
        </h2>
        <Pill tone="neutral" size="sm">
          ranked by divergence
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
