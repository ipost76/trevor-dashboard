import * as React from "react";
import { cookies } from "next/headers";
import { cache } from "react";
import { AppShellNav } from "./app-shell-nav";
import { LegacyAppShell } from "./app-shell-legacy";
import { getAllFlagsCached } from "@/lib/feature-flags-server";

/**
 * Server component — branches between LegacyAppShell (pre-redesign chrome)
 * and AppShellNav (B1 BottomNav + SidebarRail + ChatFAB) based on the
 * HUB_REDESIGN_NAV flag.
 *
 * Resolution order (first match wins):
 *  1. Cookie override `hub_redesign_override` containing
 *     `HUB_REDESIGN_NAV=true` — Ghost-only preview without flipping the
 *     global flag.
 *  2. auto_config DB row HUB_REDESIGN_NAV (read directly via the shared
 *     server reader — bypasses /api/feature-flags HTTP self-fetch which
 *     would be gated by middleware auth).
 *  3. Default false → render LegacyAppShell.
 *
 * The DB read goes through the shared request-scoped `getAllFlagsCached`
 * (PERF-03) so this gate plus any zone page's own gate collapse to ONE
 * `query_feature_flags.py` spawn per render. The outer `cache()` still
 * memoizes this gate's cookie+flag resolution.
 */
const isHubRedesignNavOn = cache(async (): Promise<boolean> => {
  try {
    const c = await cookies();
    const raw = c.get("hub_redesign_override")?.value;
    if (
      raw &&
      decodeURIComponent(raw)
        .split(",")
        .some((p) => p.trim() === "HUB_REDESIGN_NAV=true")
    ) {
      return true;
    }
  } catch {
    // cookies() unavailable — fall through to DB read
  }

  const flags = await getAllFlagsCached();
  return flags?.HUB_REDESIGN_NAV?.value === true;
});

export async function AppShell({ children }: { children: React.ReactNode }) {
  const useNew = await isHubRedesignNavOn();
  if (useNew) return <AppShellNav>{children}</AppShellNav>;
  return <LegacyAppShell>{children}</LegacyAppShell>;
}
