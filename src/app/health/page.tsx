import { HealthSection } from "@/components/memory/health-section";
import { AiDocsFeed } from "@/components/memory/ai-docs-feed";
import { CostTrackerCard } from "@/components/memory/cost-tracker-card";
import { ActivityFeedSection } from "@/components/memory/activity-feed-section";
import { ShadowWeekCard } from "@/components/shadow/shadow-week-card";

export const dynamic = "force-dynamic";

// B4 — top-level "Health" home. Three sub-tabs:
//   - default "health": <HealthSection> (AI findings panel + Killswitch +
//     Data-Freshness + Reconcile + ShadowLab + Heartbeat + Sentinels).
//   - "docs": <AiDocsFeed> — the AI recon-doc feed (ai_findings.recon_md), a
//     surface entirely separate from the bottom-nav DOCS zone (/docs).
//   - "cost": <CostTrackerCard> — the GCP cost tracker (B4), reading the
//     data/hub.db cost_snapshots cache (never BigQuery on page load).
//   - "activity" (B7, labelled "Digest"): <ActivityFeedSection> — per-day
//     nightly-digest cards from the replica's `digest` table (built VM-side by
//     B1-B6), expandable inline, downloadable as .md or PDF. Read-only.
// The <ZoneSubTabs> strip (auto-rendered from navigation.ts subTabs) writes ?tab=.
// The /memory?tab=health deep link still 308-redirects here via middleware.ts.
// The centering wrapper mirrors MemoryZoneView's `mx-auto w-full max-w-screen-2xl`.
interface HealthPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function HealthPage({ searchParams }: HealthPageProps) {
  const { tab } = await searchParams;
  return (
    <div className="mx-auto w-full max-w-screen-2xl">
      {tab === "cost" ? (
        <CostTrackerCard />
      ) : tab === "docs" ? (
        <AiDocsFeed />
      ) : tab === "activity" ? (
        <ActivityFeedSection />
      ) : (
        <>
          {/* RM-CUTOVER C4 Phase 2 — the dual-instance shadow-week card. ADDITIVE:
              a NEW card reading the NEW /api/shadow-week route. <HealthSection />
              and every other surface below keep their existing data sources
              unchanged — the Hub still reads the VM. */}
          <ShadowWeekCard />
          <HealthSection />
        </>
      )}
    </div>
  );
}
