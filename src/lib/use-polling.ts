import { useEffect, useRef, useCallback } from "react";

/**
 * Poll a callback at `intervalMs`, pausing when the tab is hidden
 * and firing immediately when the tab becomes visible again.
 */
export function usePolling(callback: () => void, intervalMs: number) {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  const poll = useCallback(() => savedCallback.current(), []);

  useEffect(() => {
    poll(); // initial fetch

    let timer = setInterval(poll, intervalMs);

    const onVisibility = () => {
      clearInterval(timer);
      if (!document.hidden) {
        poll(); // refresh immediately on tab focus
        timer = setInterval(poll, intervalMs);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [poll, intervalMs]);
}
