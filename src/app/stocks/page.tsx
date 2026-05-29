import * as React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { runPython } from "@/lib/api-helpers";
import { StocksZoneView } from "@/components/stocks/stocks-zone-view";
import { StockSection } from "@/components/stocks/stock-section";

export const dynamic = "force-dynamic";

interface StocksPageProps {
  searchParams: Promise<{ tab?: string }>;
}

// Gated by the `HUB_REDESIGN_SCALP` auto_config flag. Wave C2 renamed the
// zone (/manual → /stocks) but deliberately kept the legacy flag key — an
// inert auto_config row — per the additive-DB rule. Flag name is a known
// misnomer; see Hub CLAUDE.md.
const isStocksZoneOn = cache(async (): Promise<boolean> => {
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
    const stdout = await runPython("query_feature_flags.py", []);
    const data = JSON.parse(stdout) as {
      flags?: Record<string, { value?: boolean }>;
    };
    return data.flags?.HUB_REDESIGN_SCALP?.value === true;
  } catch {
    return false;
  }
});

function StocksDisabled() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center font-mono">
      <div className="text-micro uppercase tracking-[0.3em] text-accent-violet/60">
        STOCKS
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

export default async function StocksPage({ searchParams }: StocksPageProps) {
  const useNew = await isStocksZoneOn();
  if (!useNew) return <StocksDisabled />;
  const { tab } = await searchParams;
  // Legacy `?tab=reminders` → DCA (REMINDERS sub-tab merged into DCA 2026-05-14).
  if (tab === "reminders") {
    redirect("/stocks?tab=dca");
  }
  // <StockSection /> is a "Coming Soon" placeholder (SCOUT-REMOVE 2026-05-28).
  // Passed as a slot prop so the slot pattern is preserved for any future
  // stock surface; client-side <StocksZoneView /> renders it when subtab=="stock".
  return <StocksZoneView subtab={tab ?? "stock"} stockSlot={<StockSection />} />;
}
