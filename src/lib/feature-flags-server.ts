/**
 * Server-only feature-flag reader (PERF-03, 2026-06-02; RHR-04 cross-request cache, 2026-06-03).
 *
 * WHY (PERF-03): `query_feature_flags.py` returns ALL `HUB_REDESIGN_*` flags in a
 * single read, yet it was spawned independently from 5 SSR sites — the AppShell NAV
 * gate (renders on every page, via the layout) PLUS each zone page's own gate. Each
 * site wrapped its read in its OWN React `cache()`, so the caches never shared:
 * rendering any zone page spawned the script TWICE (layout NAV + the page gate)
 * for what is one identical DB read. FIX: a SINGLE shared `cache()`-wrapped reader.
 * React `cache()` dedupes within one SSR render pass, so every gate that reads a
 * flag during a render now hits ONE `query_feature_flags.py` spawn — not N.
 *
 * WHY (RHR-04): React `cache()` only dedupes WITHIN one render pass — so EVERY SSR
 * request still re-spawned `query_feature_flags.py`, and that ~70–130ms spawn was
 * the sole SSR first-byte blocker on the Hub (PERF-07 finding; per-page Suspense
 * can't unblock a root-layout `await`). FIX: a module-level `createSwrCache` 45s
 * cross-request layer (single key). First request in a cold/expired window spawns
 * Python and stores `{value, ts}`; requests within 45s serve from memory, dropping
 * the spawn off first byte. `staleWhileRevalidate:false` (await-on-expiry) so the
 * first request after expiry re-spawns and immediately reflects current flag values
 * — no N+1 staleness lag (mirrors `/api/heartbeat`). Single-flight collapses a burst
 * of concurrent cold/expired renders to ONE spawn. Flags change only via CC prompts
 * editing `auto_config` (never live UI), so a ≤45s propagation window is acceptable.
 * READ-ONLY on the flag source — the cache never writes `auto_config` / `trevor.db`.
 *
 * Server-only: importing `runPython` pulls in `child_process`, so this module can
 * never be bundled into a client component (same implicit boundary the SSR pages
 * already rely on by importing `runPython` directly).
 *
 * Fail-safe: returns `{}` on any error so callers default every flag to off — the
 * same fail-closed-to-legacy behavior the inline reads had. The fail-safe lives in
 * the OUTER wrapper, NOT the cached compute: a transient spawn failure rejects (cold
 * → `{}`, byte-identical to before) and is NEVER stored as "all flags off" for the
 * TTL; a warm failure keeps serving the last-good flags (strictly better).
 */
import { cache } from "react";
import { runPython } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";

export type FlagValues = Record<string, { value?: boolean; updated_at?: string }>;

/** RHR-04: cross-request flag cache. 45s TTL, single-flight (conc 1 — one logical
 *  origin: the one `query_feature_flags.py` spawn). Module-level so it persists
 *  across requests, unlike the request-scoped React `cache()` below. */
const flagCache = createSwrCache<FlagValues>({ defaultTtl: 45_000, concurrency: 1 });

/** The raw read. THROWS on spawn/parse failure (no fail-safe here) so a transient
 *  failure is never cached as `{}`; the fail-safe is applied by `getAllFlagsCached`. */
async function readAllFlags(): Promise<FlagValues> {
  const stdout = await runPython("query_feature_flags.py", []);
  const data = JSON.parse(stdout) as { flags?: FlagValues };
  return data.flags ?? {};
}

/**
 * Deduped read of all HUB_REDESIGN_* flags. React `cache()` dedupes WITHIN a render
 * pass; the module-level `flagCache` (RHR-04) dedupes ACROSS requests for 45s so the
 * Python spawn drops off first byte on cache hits. Returns `{}` on any failure.
 */
export const getAllFlagsCached = cache(async (): Promise<FlagValues> => {
  try {
    const { value } = await flagCache.swr("flags", readAllFlags, {
      staleWhileRevalidate: false,
    });
    return value;
  } catch {
    return {};
  }
});
