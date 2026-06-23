import { HealthSection } from "@/components/memory/health-section";
import { AiDocsFeed } from "@/components/memory/ai-docs-feed";
import { CostTrackerCard } from "@/components/memory/cost-tracker-card";

export const dynamic = "force-dynamic";

// B4 — top-level "Health" home. Three sub-tabs:
//   - default "health": <HealthSection> (AI findings panel + Killswitch +
//     Data-Freshness + Reconcile + ShadowLab + Heartbeat + Sentinels).
//   - "docs": <AiDocsFeed> — the AI recon-doc feed (ai_findings.recon_md), a
//     surface entirely separate from the bottom-nav DOCS zone (/docs).
//   - "cost": <CostTrackerCard> — the GCP cost tracker (B4), reading the
//     data/hub.db cost_snapshots cache (never BigQuery on page load).
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
      ) : (
        <HealthSection />
      )}
    </div>
  );
}
