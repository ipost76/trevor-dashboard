import * as React from "react";
import { cookies } from "next/headers";
import { cache } from "react";
import { runPython } from "@/lib/api-helpers";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const dynamic = "force-dynamic";

/**
 * C2 (2026-04-30): DashboardPlaceholder deleted. When the flag is OFF the
 * page renders a small inline disabled message so Wave C's redesign can be
 * cleanly toggled without re-introducing a separate placeholder file.
 *
 * Resolution mirrors src/components/app-shell.tsx (B1):
 *  1. Cookie override `hub_redesign_override=HUB_REDESIGN_DASHBOARD=true`
 *  2. auto_config DB row HUB_REDESIGN_DASHBOARD (via runPython, NOT
 *     /api/feature-flags HTTP self-fetch — that path is auth-gated)
 *  3. Default false → render disabled message
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

function DashboardDisabled() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center font-mono">
      <div className="text-micro uppercase tracking-[0.3em] text-accent-amber/60">
        DASHBOARD
      </div>
      <h1 className="text-h2 text-fg-primary">Temporarily Disabled</h1>
      <p className="max-w-md text-caption text-fg-muted">
        Set{" "}
        <code className="rounded bg-bg-elevated px-2 py-0.5 text-accent-cyan">
          HUB_REDESIGN_DASHBOARD=true
        </code>{" "}
        in <code>auto_config</code> to enable.
      </p>
      <p className="max-w-md text-micro text-fg-muted">
        Bot remains live · AutoTrader remains live · Discord killswitch still operational
      </p>
    </div>
  );
}

export default async function DashboardPage() {
  const useNew = await isHubRedesignDashboardOn();
  return useNew ? <DashboardView /> : <DashboardDisabled />;
}
