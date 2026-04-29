"use client";
import { useCallback, useRef } from "react";

/**
 * Long-press handler set. Spread the result onto any element:
 *   const handlers = useLongPress(() => openMenu());
 *   <div {...handlers}>…</div>
 *
 * Triggers `onLongPress` after `ms` (default 450ms) of continuous press.
 * Best-effort haptic feedback via `navigator.vibrate(20)` where supported.
 */
export function useLongPress(onLongPress: () => void, ms = 450) {
  const timer = useRef<number | null>(null);

  const start = useCallback(() => {
    timer.current = window.setTimeout(() => {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try {
          navigator.vibrate(20);
        } catch {
          // no-op: vibration not supported
        }
      }
      onLongPress();
    }, ms);
  }, [onLongPress, ms]);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  return {
    onMouseDown: start,
    onMouseUp: clear,
    onMouseLeave: clear,
    onTouchStart: start,
    onTouchEnd: clear,
    onTouchCancel: clear,
  };
}
