"use client";
import { useEffect, useState } from "react";

export type ScrollDirection = "up" | "down" | null;

/**
 * Tracks vertical scroll direction with rAF throttling. Returns:
 *   - "down" when the user is scrolling down past `threshold` px
 *   - "up"   when the user is scrolling up past `threshold` px
 *   - null   on initial mount (before any scroll event)
 *
 * SSR-safe: returns null when window is undefined; effect only attaches
 * client-side. Listener uses { passive: true } to avoid blocking scroll.
 */
export function useScrollDirection(threshold = 8): ScrollDirection {
  const [dir, setDir] = useState<ScrollDirection>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let lastY = window.scrollY;
    let ticking = false;

    const update = () => {
      const y = window.scrollY;
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
  }, [threshold]);

  return dir;
}
