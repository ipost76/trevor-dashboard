import * as React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { runPython } from "@/lib/api-helpers";
import { ScalpZoneView } from "@/components/scalp/scalp-zone-view";
import { StockSection } from "@/components/scalp/stock-section";

export const dynamic = "force-dynamic";

interface ManualPageProps {
  searchParams: Promise<{ tab?: string }>;
}

const isHubRedesignManualOn = cache(async (): Promise<boolean> => {
  try {
    const c = await cookies();
    const raw = c.get("hub_redesign_override")?.value;
    if (
      raw &&
      decodeURIComponent(raw)
        .split(",")
        .some((p) => p.trim() === "HUB_REDESIGN_SCALP=true")
    ) {
      return true;
    }
  } catch {
    // cookies() unavailable — fall through to DB read
  }

  try {
    const stdout = runPython("query_feature_flags.py", []);
    const data = JSON.parse(stdout) as {
      flags?: Record<string, { value?: boolean }>;
    };
    return data.flags?.HUB_REDESIGN_SCALP?.value === true;
  } catch {
    return false;
  }
});

function ManualDisabled() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center font-mono">
      <div className="text-micro uppercase tracking-[0.3em] text-accent-violet/60">
        MANUAL
      </div>
      <h1 className="text-h2 text-fg-primary">Temporarily Disabled</h1>
      <p className="max-w-md text-caption text-fg-muted">
        Set{" "}
        <code className="rounded bg-bg-elevated px-2 py-0.5 text-accent-cyan">
          HUB_REDESIGN_SCALP=true
        </code>{" "}
        in <code>auto_config</code> to enable.
      </p>
      <p className="max-w-md text-micro text-fg-muted">
        Bot remains live · AutoTrader remains live · Discord killswitch still operational
      </p>
    </div>
  );
}

export default async function ManualPage({ searchParams }: ManualPageProps) {
  const useNew = await isHubRedesignManualOn();
  if (!useNew) return <ManualDisabled />;
  const { tab } = await searchParams;
  // Legacy `?tab=reminders` → DCA (REMINDERS sub-tab merged into DCA 2026-05-14).
  if (tab === "reminders") {
    redirect("/manual?tab=dca");
  }
  // <StockSection /> is an async server component (reads SCOUT_V3_FEED flag);
  // we render it here so the client-side <ScalpZoneView /> can receive it as
  // a prop slot. RSC import boundary: client components cannot import server
  // components, but they can accept them as props.
  return <ScalpZoneView subtab={tab ?? "scalp"} stockSlot={<StockSection />} />;
}
