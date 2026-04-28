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
  "HUB_REDESIGN_CHAT",
];

/**
 * Server-side flag read. Spawns python query script via api-helpers.
 * Returns false if DB read fails (fail-safe to old layout).
 *
 * Stub for A1: returns default false. Wave B1 wires the real implementation
 * (will fetch from /api/feature-flags or read auto_config directly via runPython).
 */
export async function readFlag(flag: FlagName): Promise<FlagState> {
  return { flag, value: false, source: "default" };
}

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

/**
 * Combined resolver: cookie override beats DB flag.
 * Used by client components.
 */
export async function isFlagOn(flag: FlagName): Promise<boolean> {
  if (readCookieOverride(flag)) return true;
  const state = await readFlag(flag);
  return state.value;
}
