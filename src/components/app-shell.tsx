import * as React from "react";
import { cookies } from "next/headers";
import { cache } from "react";
import { AppShellNav } from "./app-shell-nav";
import { LegacyAppShell } from "./app-shell-legacy";
import { runPython } from "@/lib/api-helpers";

/**
 * Server component — branches between LegacyAppShell (pre-redesign chrome)
 * and AppShellNav (B1 BottomNav + SidebarRail + ChatFAB) based on the
 * HUB_REDESIGN_NAV flag.
 *
 * Resolution order (first match wins):
 *  1. Cookie override `hub_redesign_override` containing
 *     `HUB_REDESIGN_NAV=true` — Ghost-only preview without flipping the
 *     global flag.
 *  2. auto_config DB row HUB_REDESIGN_NAV (read directly via runPython
 *     — bypasses /api/feature-flags HTTP self-fetch which would be gated
 *     by middleware auth).
 *  3. Default false → render LegacyAppShell.
 *
 * Memoized with React `cache()` so a single page render hits the flag
 * resolver once even if multiple server-component reads occur.
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

  try {
    const stdout = await runPython("query_feature_flags.py", []);
    const data = JSON.parse(stdout) as {
      flags?: Record<string, { value?: boolean }>;
    };
    return data.flags?.HUB_REDESIGN_NAV?.value === true;
  } catch {
    return false;
  }
});

export async function AppShell({ children }: { children: React.ReactNode }) {
  const useNew = await isHubRedesignNavOn();
  if (useNew) return <AppShellNav>{children}</AppShellNav>;
  return <LegacyAppShell>{children}</LegacyAppShell>;
}
