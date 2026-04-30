import * as React from "react";
import { cookies } from "next/headers";
import { cache } from "react";
import { runPython } from "@/lib/api-helpers";
import { LegacyAutotraderView } from "@/components/autotrader/legacy-autotrader-view";
import { ScalperViewV2 } from "@/components/autotrader-v2/scalper-view";

export const dynamic = "force-dynamic";

// D1 (2026-04-30): /autotrader gates HUB_REDESIGN_AUTO via the same
// pattern as /dashboard (C2) and the app shell (B1). Cookie override
// `hub_redesign_override=HUB_REDESIGN_AUTO=true` allows preview
// without flipping the global flag. Memoized via React cache().
const isHubRedesignAutoOn = cache(async (): Promise<boolean> => {
  try {
    const c = await cookies();
    const raw = c.get("hub_redesign_override")?.value;
    if (
      raw &&
      decodeURIComponent(raw)
        .split(",")
        .some((p) => p.trim() === "HUB_REDESIGN_AUTO=true")
    ) {
      return true;
    }
  } catch {
    /* cookies() unavailable — fall through to DB read */
  }

  try {
    const stdout = runPython("query_feature_flags.py", []);
    const data = JSON.parse(stdout) as {
      flags?: Record<string, { value?: boolean }>;
    };
    return data.flags?.HUB_REDESIGN_AUTO?.value === true;
  } catch {
    return false;
  }
});

interface AutotraderPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function AutotraderPage({
  searchParams,
}: AutotraderPageProps) {
  const { tab } = await searchParams;
  const useNew = await isHubRedesignAutoOn();
  if (useNew) return <ScalperViewV2 subtab={tab ?? "scalper"} />;
  return <LegacyAutotraderView />;
}
