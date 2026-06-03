/**
 * Hub Redesign feature flags.
 *
 * Master + wave-level flags read from auto_config table via /api/feature-flags.
 * Default false until each wave ships and Ghost flips the flag.
 *
 * Cookie override (Ghost-only): set cookie `hub_redesign_override=<flag_name>=true`
 * to test the new layout without flipping the DB flag. Honored only when the
 * existing trevor_session cookie is valid.
 */

export type FlagName =
  | "HUB_REDESIGN_MODE"
  | "HUB_REDESIGN_NAV"
  | "HUB_REDESIGN_DASHBOARD"
  | "HUB_REDESIGN_AUTO"
  | "HUB_REDESIGN_AUTO_API"
  | "HUB_REDESIGN_SCALP"
  | "HUB_REDESIGN_INTEL"
  | "HUB_REDESIGN_MEMORY"
  | "HUB_REDESIGN_DOCS"
  | "HUB_REDESIGN_CHAT";

export interface FlagState {
  flag: FlagName;
  value: boolean;
  source: "db" | "cookie-override" | "default";
  updated_at?: string;
}

export const ALL_FLAGS: FlagName[] = [
  "HUB_REDESIGN_MODE",
  "HUB_REDESIGN_NAV",
  "HUB_REDESIGN_DASHBOARD",
  "HUB_REDESIGN_AUTO",
  "HUB_REDESIGN_AUTO_API",
  "HUB_REDESIGN_SCALP",
  "HUB_REDESIGN_INTEL",
  "HUB_REDESIGN_MEMORY",
  "HUB_REDESIGN_DOCS",
  "HUB_REDESIGN_CHAT",
];

// QUAL-03 (2026-06-03): the dead `readFlag()` stub (always returned default
// false) + its sole caller `isFlagOn()` were removed. Both were unreferenced —
// the real server-side flag source is `getAllFlagsCached` in
// `feature-flags-server.ts` (PERF-03). `readCookieOverride` below + the
// `FlagName`/`ALL_FLAGS`/`FlagState` type surface are retained.

/**
 * Client-side cookie override read. Lets Ghost preview new layout per-session.
 * Format: hub_redesign_override=HUB_REDESIGN_NAV=true,HUB_REDESIGN_DASHBOARD=true
 */
export function readCookieOverride(flag: FlagName): boolean {
  if (typeof document === "undefined") return false; // SSR safe
  const raw = document.cookie
    .split("; ")
    .find((c) => c.startsWith("hub_redesign_override="));
  if (!raw) return false;
  const value = raw.split("=").slice(1).join("=");
  const pairs = decodeURIComponent(value).split(",");
  for (const pair of pairs) {
    const [k, v] = pair.split("=");
    if (k === flag && v === "true") return true;
  }
  return false;
}
