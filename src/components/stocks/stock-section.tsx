import * as React from "react";
import { cookies } from "next/headers";
import { cache } from "react";

import { runPython } from "@/lib/api-helpers";
import { DiscoveryFeed } from "@/components/scout/discovery-feed";
import { DiscoveryFeedV3 } from "@/components/scout/discovery-feed-v3";

/**
 * STOCK sub-tab — SCOUT discovery feed.
 *
 * Server component (no "use client"). Reads SCOUT_V3_FEED from auto_config
 * and conditionally renders v2 (frozen) or v3 (G4a). Composes cleanly with
 * the parent HUB_REDESIGN_SCALP gate at /manual/page.tsx:
 *
 *   HUB_REDESIGN_SCALP=true AND SCOUT_V3_FEED=true   → v3 (this prompt)
 *   HUB_REDESIGN_SCALP=true AND SCOUT_V3_FEED=false  → v2 (default, byte-identical)
 *   HUB_REDESIGN_SCALP=false                         → ManualDisabled (no /stock route)
 *
 * Cookie override: hub_redesign_override=SCOUT_V3_FEED=true previews v3
 * without flipping the DB flag (Ghost-only).
 *
 * Fail-safe: any error in flag resolution → v2 (closed).
 */

const isScoutV3FeedOn = cache(async (): Promise<boolean> => {
  try {
    const c = await cookies();
    const raw = c.get("hub_redesign_override")?.value;
    if (
      raw &&
      decodeURIComponent(raw)
        .split(",")
        .some((p) => p.trim() === "SCOUT_V3_FEED=true")
    ) {
      return true;
    }
  } catch {
    // cookies() unavailable — fall through to DB read
  }

  try {
    const stdout = runPython("query_scout_v3_flag.py", []);
    const data = JSON.parse(stdout) as { enabled?: boolean };
    return data?.enabled === true;
  } catch {
    return false; // fail-safe closed
  }
});

export async function StockSection() {
  const useV3 = await isScoutV3FeedOn();
  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      {useV3 ? <DiscoveryFeedV3 /> : <DiscoveryFeed />}
    </div>
  );
}
