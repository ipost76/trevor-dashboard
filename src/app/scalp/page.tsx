import * as React from "react";
import { cookies } from "next/headers";
import { cache } from "react";
import { runPython } from "@/lib/api-helpers";
import { ScalpZoneView } from "@/components/scalp/scalp-zone-view";

export const dynamic = "force-dynamic";

const isHubRedesignScalpOn = cache(async (): Promise<boolean> => {
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

function ScalpDisabled() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center font-mono">
      <div className="text-micro uppercase tracking-[0.3em] text-accent-violet/60">
        SCALP
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

interface ScalpPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function ScalpPage({ searchParams }: ScalpPageProps) {
  const { tab } = await searchParams;
  const useNew = await isHubRedesignScalpOn();
  return useNew ? <ScalpZoneView subtab={tab ?? "live-board"} /> : <ScalpDisabled />;
}
