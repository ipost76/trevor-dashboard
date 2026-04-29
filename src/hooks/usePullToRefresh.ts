"use client";
import { useEffect, useRef, useState } from "react";

export interface PullToRefreshOptions {
  onRefresh: () => Promise<void> | void;
  threshold?: number;
  enabled?: boolean;
}

/**
 * Mobile pull-to-refresh helper.
 * - Only engages when scrollY === 0 (top of page).
 * - Returns { pullDistance, isRefreshing } for progress UI.
 * - Calls `onRefresh` when the user releases past `threshold` (default 64px).
 */
export function usePullToRefresh({
  onRefresh,
  threshold = 64,
  enabled = true,
}: PullToRefreshOptions) {
  const startY = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY > 0) return;
      startY.current = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startY.current === null || isRefreshing) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta > 0 && window.scrollY <= 0) {
        setPullDistance(Math.min(delta, threshold * 1.5));
      }
    };

    const onTouchEnd = async () => {
      if (startY.current === null) return;
      if (pullDistance >= threshold && !isRefreshing) {
        setIsRefreshing(true);
        try {
          await onRefresh();
        } finally {
          setIsRefreshing(false);
          setPullDistance(0);
        }
      } else {
        setPullDistance(0);
      }
      startY.current = null;
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [enabled, threshold, onRefresh, pullDistance, isRefreshing]);

  return { pullDistance, isRefreshing };
}
