/**
 * Server-only feature-flag reader (PERF-03, 2026-06-02).
 *
 * WHY: `query_feature_flags.py` returns ALL `HUB_REDESIGN_*` flags in a single
 * read, yet it was spawned independently from 5 SSR sites — the AppShell NAV gate
 * (renders on every page, via the layout) PLUS each zone page's own gate. Each
 * site wrapped its read in its OWN React `cache()`, so the caches never shared:
 * rendering any zone page spawned the script TWICE (layout NAV + the page gate)
 * for what is one identical DB read.
 *
 * FIX: a SINGLE shared `cache()`-wrapped reader. React `cache()` dedupes within
 * one SSR render pass, so every gate that reads a flag during a render now hits
 * ONE `query_feature_flags.py` spawn — not N. Cookie-override resolution stays at
 * each call site (per-flag, no spawn); only the DB read is shared here.
 *
 * Server-only: importing `runPython` pulls in `child_process`, so this module can
 * never be bundled into a client component (same implicit boundary the SSR pages
 * already rely on by importing `runPython` directly).
 *
 * Fail-safe: returns `{}` on any error so callers default every flag to off — the
 * same fail-closed-to-legacy behavior the inline reads had.
 */
import { cache } from "react";
import { runPython } from "@/lib/api-helpers";

export type FlagValues = Record<string, { value?: boolean; updated_at?: string }>;

/**
 * Request-scoped, deduped read of all HUB_REDESIGN_* flags. ONE spawn per render
 * pass no matter how many server components call it. Returns `{}` on any failure.
 */
export const getAllFlagsCached = cache(async (): Promise<FlagValues> => {
  try {
    const stdout = await runPython("query_feature_flags.py", []);
    const data = JSON.parse(stdout) as { flags?: FlagValues };
    return data.flags ?? {};
  } catch {
    return {};
  }
});
