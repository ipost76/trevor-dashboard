import * as React from "react";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { runPython } from "@/lib/api-helpers";
import { DocsZoneView } from "./docs-zone-view";

export const dynamic = "force-dynamic";

/**
 * Wave D1 — /docs route scaffold.
 *
 * Gated by the `HUB_REDESIGN_DOCS` auto_config flag (default false). Mirrors
 * the /intel flag-gate pattern, except a disabled flag returns notFound()
 * (HTTP 404) instead of an in-page "disabled" placeholder — the scaffold stays
 * invisible to production users until Wave D2 migrates the Downloads / Lessons
 * / Journal content from /intel and Ghost flips the flag on.
 */
const isHubRedesignDocsOn = cache(async (): Promise<boolean> => {
  try {
    const c = await cookies();
    const raw = c.get("hub_redesign_override")?.value;
    if (
      raw &&
      decodeURIComponent(raw)
        .split(",")
        .some((p) => p.trim() === "HUB_REDESIGN_DOCS=true")
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
    return data.flags?.HUB_REDESIGN_DOCS?.value === true;
  } catch {
    return false;
  }
});

interface DocsPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function DocsPage({ searchParams }: DocsPageProps) {
  const useNew = await isHubRedesignDocsOn();
  // Flag OFF → 404 (no leaky placeholder for production users; Wave D1 spec).
  if (!useNew) notFound();
  const { tab } = await searchParams;
  return <DocsZoneView subtab={tab ?? "downloads"} />;
}
