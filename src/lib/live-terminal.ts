/**
 * Live-terminal feature flag — the single kill switch for the whole
 * live-terminal build [RM-LIVE Wave B / B3].
 *
 * DEFAULT OFF. Every Round-2/3 live-terminal consumer gates on `useLiveTerminal()`
 * (or `isLiveTerminalEnabled()` on the server), so flipping this OFF instantly
 * reverts the Hub to its current behavior. Nothing imports it yet, so shipping
 * this file changes nothing.
 *
 * ── Rollback contract ────────────────────────────────────────────────────────
 *   Build-time base:   env `NEXT_PUBLIC_LIVE_TERMINAL`
 *                        "1"            → ON
 *                        unset / "0"    → OFF   (the default — current behavior)
 *   Client override:   localStorage `trevor-live-terminal` (browser only)
 *                        "1"            → force ON   (no rebuild needed)
 *                        "0"            → force OFF
 *                        absent / other → defer to the env base
 *
 *   Fully OFF = env unset/"0" AND no override (or override "0"). In that state the
 *   whole live layer is dark and the Hub behaves exactly as it does today. Setting
 *   the env to "0"/unset (and clearing the override) is the rollback.
 *
 * This is intentionally SEPARATE from the DB-backed `HUB_REDESIGN_*` system in
 * `feature-flags.ts` — this is an env + localStorage client-side kill switch, not
 * an `auto_config` flag. SSR-safe: the server reads only the env value; `window` /
 * `localStorage` are touched solely in the browser, guarded.
 *
 * NOTE: `process.env.NEXT_PUBLIC_LIVE_TERMINAL` is referenced as a literal (not via
 * an indirected key) so Next.js statically inlines it into the client bundle at
 * build time — do not refactor it behind a variable.
 */

import { useEffect, useState } from "react";

/** localStorage key for the no-rebuild client override ("1" / "0"). */
const OVERRIDE_KEY = "trevor-live-terminal";

/**
 * The effective live-terminal flag. Universal (server- or client-callable).
 *
 * Base value is the build-time env `NEXT_PUBLIC_LIVE_TERMINAL === "1"`. In the
 * browser, a `localStorage` override of "1"/"0" takes precedence; any other or
 * absent override (and the server) falls back to the env value. Defaults to
 * `false` when nothing is set.
 */
export function isLiveTerminalEnabled(): boolean {
  const envEnabled = process.env.NEXT_PUBLIC_LIVE_TERMINAL === "1";

  // Server / non-browser: env value only — never touch window/localStorage.
  if (typeof window === "undefined") return envEnabled;

  try {
    const override = window.localStorage.getItem(OVERRIDE_KEY);
    if (override === "1") return true;
    if (override === "0") return false;
  } catch {
    // localStorage unavailable (private mode / disabled) → defer to env.
  }

  return envEnabled;
}

/**
 * React hook returning the effective live-terminal flag.
 *
 * Returns `false` on the server and on the first client render (so SSR and the
 * first paint agree — no hydration mismatch and a byte-identical default-OFF),
 * then resolves to the real value after mount. Re-reads on the cross-tab
 * `storage` event so flipping the override in another tab propagates here.
 */
export function useLiveTerminal(): boolean {
  const [enabled, setEnabled] = useState<boolean>(false);

  useEffect(() => {
    setEnabled(isLiveTerminalEnabled());

    const onStorage = (event: StorageEvent): void => {
      if (event.key === OVERRIDE_KEY || event.key === null) {
        setEnabled(isLiveTerminalEnabled());
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return enabled;
}
