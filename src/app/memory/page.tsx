import * as React from "react";
import { cookies } from "next/headers";
import { cache } from "react";
import { getAllFlagsCached } from "@/lib/feature-flags-server";
import { MemoryZoneView } from "@/components/memory/memory-zone-view";
import { WatcherZoneView } from "@/components/watcher/watcher-zone-view";

export const dynamic = "force-dynamic";

const isHubRedesignMemoryOn = cache(async (): Promise<boolean> => {
  try {
    const c = await cookies();
    const raw = c.get("hub_redesign_override")?.value;
    if (
      raw &&
      decodeURIComponent(raw)
        .split(",")
        .some((p) => p.trim() === "HUB_REDESIGN_MEMORY=true")
    ) {
      return true;
    }
  } catch {
    // cookies() unavailable — fall through to DB read
  }

  const flags = await getAllFlagsCached();
  return flags?.HUB_REDESIGN_MEMORY?.value === true;
});

// R12-B2: when HUB_REDESIGN_WATCHER is ON, /memory renders the WATCHER cockpit
// (critique / errors / integrity / level / loops). Default OFF -> byte-identical
// fall-through to the existing loop_health glance. The `Memory` -> `Watcher`
// zone rename + the sub-tab strip live in navigation.ts (B3's file).
const isHubRedesignWatcherOn = cache(async (): Promise<boolean> => {
  try {
    const c = await cookies();
    const raw = c.get("hub_redesign_override")?.value;
    if (
      raw &&
      decodeURIComponent(raw)
        .split(",")
        .some((p) => p.trim() === "HUB_REDESIGN_WATCHER=true")
    ) {
      return true;
    }
  } catch {
    // cookies() unavailable — fall through to DB read
  }

  const flags = await getAllFlagsCached();
  return flags?.HUB_REDESIGN_WATCHER?.value === true;
});

function MemoryDisabled() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center font-mono">
      <div className="text-micro uppercase tracking-[0.3em] text-accent-cyan/60">
        MEMORY
      </div>
      <h1 className="text-h2 text-fg-primary">Temporarily Disabled</h1>
      <p className="max-w-md text-caption text-fg-muted">
        This section is switched off.
      </p>
    </div>
  );
}

interface MemoryPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function MemoryPage({ searchParams }: MemoryPageProps) {
  const { tab } = await searchParams;
  // WATCHER cockpit wins when its flag is on (default OFF -> unchanged below).
  if (await isHubRedesignWatcherOn()) {
    return <WatcherZoneView subtab={tab ?? "errors"} />;
  }
  const useNew = await isHubRedesignMemoryOn();
  if (!useNew) return <MemoryDisabled />;
  return <MemoryZoneView subtab={tab ?? "intel"} />;
}
