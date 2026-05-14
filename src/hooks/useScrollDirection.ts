"use client";
import { useEffect, useState } from "react";

export type ScrollDirection = "up" | "down" | null;

/**
 * Tracks vertical scroll direction with rAF throttling. Returns:
 *   - "down" when the user is scrolling down past `threshold` px
 *   - "up"   when the user is scrolling up past `threshold` px
 *   - null   on initial mount (before any scroll event)
 *
 * @param threshold  minimum scroll delta (px) to register a direction change
 * @param minScrollY suppress "down" until the page is scrolled past this y.
 *                   Prevents iOS Safari address-bar-collapse from
 *                   false-triggering the header hide while the user has
 *                   barely scrolled. Default 0.
 *
 * SSR-safe: returns null when window is undefined; effect only attaches
 * client-side. Listener uses { passive: true } to avoid blocking scroll.
 */
export function useScrollDirection(
  threshold = 8,
  minScrollY = 0,
): ScrollDirection {
  const [dir, setDir] = useState<ScrollDirection>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let lastY = window.scrollY;
    let ticking = false;

    const update = () => {
      const y = window.scrollY;
      // Near top of page: force "up" so consumers keep the header visible.
      // iOS Safari fires ~50px of phantom scroll while collapsing the
      // address bar — without this guard, the hook would flip to "down"
      // before the user has actually scrolled the document.
      if (y <= minScrollY) {
        if (dir !== "up") setDir("up");
        lastY = y;
        ticking = false;
        return;
      }
      if (Math.abs(y - lastY) >= threshold) {
        setDir(y > lastY ? "down" : "up");
        lastY = y;
      }
      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
    // dir is intentionally not in the dep array — we read its current
    // value inside `update` via closure-of-closure and the setter is
    // referentially stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold, minScrollY]);

  return dir;
}
