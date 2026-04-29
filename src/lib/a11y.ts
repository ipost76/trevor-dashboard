/**
 * Accessibility utilities used across Hub design-system components (A4).
 *
 * Floor we hit:
 *  - Min tap target: 44x44px (use the .tap-target utility class).
 *  - Color contrast: WCAG AA on every text/bg pair in the cyberpunk palette.
 *  - All interactive elements keyboard-navigable.
 *  - aria-* attributes on Pill, SegmentedToggle, TabBar, BottomSheet, Skeleton.
 *  - Reduced motion respected via `prefers-reduced-motion` @media in globals.css.
 *  - Focus indicators: outline on accent-cyan/60 + outline-offset-2.
 */

export const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-cyan/60 focus-visible:outline-offset-2";

/** Returns a stable id-with-prefix; pass to aria-labelledby or htmlFor. */
export function reactId(prefix: string, key: string | number) {
  return `${prefix}-${String(key)}`;
}
