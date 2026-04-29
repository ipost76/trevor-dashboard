import * as React from "react";
import { cookies } from "next/headers";
import { cache } from "react";
import { runPython } from "@/lib/api-helpers";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const dynamic = "force-dynamic";

/**
 * C1 (2026-04-29): server component branches between DashboardPlaceholder
 * (pre-redesign stub from A3) and DashboardView (HeroPnLCard + ActivePositionsCard)
 * based on the HUB_REDESIGN_DASHBOARD flag.
 *
 * Resolution mirrors src/components/app-shell.tsx (B1):
 *  1. Cookie override `hub_redesign_override=HUB_REDESIGN_DASHBOARD=true`
 *  2. auto_config DB row HUB_REDESIGN_DASHBOARD (via runPython, NOT
 *     /api/feature-flags HTTP self-fetch — that path is auth-gated)
 *  3. Default false → render DashboardPlaceholder
 *
 * Memoized via React `cache()` so multi-read renders hit the resolver once.
 */
const isHubRedesignDashboardOn = cache(async (): Promise<boolean> => {
  try {
    const c = await cookies();
    const raw = c.get("hub_redesign_override")?.value;
    if (
      raw &&
      decodeURIComponent(raw)
        .split(",")
        .some((p) => p.trim() === "HUB_REDESIGN_DASHBOARD=true")
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
    return data.flags?.HUB_REDESIGN_DASHBOARD?.value === true;
  } catch {
    return false;
  }
});

export default async function DashboardPage() {
  const useNew = await isHubRedesignDashboardOn();
  return useNew ? <DashboardView /> : <DashboardPlaceholder />;
}
