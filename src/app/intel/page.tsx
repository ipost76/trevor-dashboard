import * as React from "react";
import { cookies } from "next/headers";
import { cache } from "react";
import { getAllFlagsCached } from "@/lib/feature-flags-server";
import { IntelZoneView } from "@/components/intel/intel-zone-view";
import { TrainerZoneView } from "@/components/trainer/trainer-zone-view";

export const dynamic = "force-dynamic";

// Flag-gate helper: cookie override (hub_redesign_override=<FLAG>=true) wins for
// per-session preview, else the auto_config value via getAllFlagsCached. Both
// HUB_REDESIGN_* flags flow through query_feature_flags.py (LIKE 'HUB_REDESIGN%')
// → no feature-flags.ts union edit needed.
const flagOn = (flag: string) =>
  cache(async (): Promise<boolean> => {
    try {
      const c = await cookies();
      const raw = c.get("hub_redesign_override")?.value;
      if (
        raw &&
        decodeURIComponent(raw)
          .split(",")
          .some((p) => p.trim() === `${flag}=true`)
      ) {
        return true;
      }
    } catch {
      // cookies() unavailable — fall through to DB read
    }
    const flags = await getAllFlagsCached();
    return flags?.[flag]?.value === true;
  });

const isHubRedesignIntelOn = flagOn("HUB_REDESIGN_INTEL");
// R12-B1: gates the whole new TRAINER UI (default OFF). OFF → the /intel zone is
// byte-identical to today (IntelZoneView, shadow/promotions). Requires
// HUB_REDESIGN_INTEL on too (the zone must exist first).
const isHubRedesignTrainerOn = flagOn("HUB_REDESIGN_TRAINER");

function IntelDisabled() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center font-mono">
      <div className="text-micro uppercase tracking-[0.3em] text-accent-magenta/60">
        Trainer
      </div>
      <h1 className="text-h2 text-fg-primary">Temporarily Disabled</h1>
      <p className="max-w-md text-caption text-fg-muted">
        This section is switched off.
      </p>
    </div>
  );
}

interface IntelPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function IntelPage({ searchParams }: IntelPageProps) {
  const { tab } = await searchParams;
  const useNew = await isHubRedesignIntelOn();
  if (!useNew) return <IntelDisabled />;
  // R12-B1: TRAINER on → the repurposed cockpit; off → today's Shadows view.
  const trainerOn = await isHubRedesignTrainerOn();
  if (trainerOn) return <TrainerZoneView subtab={tab ?? "search"} />;
  return <IntelZoneView subtab={tab ?? "shadow"} />;
}
