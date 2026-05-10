"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface State<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
}

/**
 * Minimal fetch hook with manual refresh + optional polling. Each call
 * passes its own AbortSignal so a tab unmount cancels in-flight requests
 * and unmounted-component setState warnings stay quiet.
 */
export function useScoutFetch<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  options: { refreshMs?: number } = {},
): State<T> & { refresh: () => void } {
  const { refreshMs } = options;
  const [state, setState] = useState<State<T>>({
    data: undefined,
    error: undefined,
    loading: true,
  });
  const epoch = useRef(0);

  const run = useCallback(() => {
    const id = ++epoch.current;
    const ac = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fetcher(ac.signal)
      .then((data) => {
        if (id !== epoch.current) return;
        setState({ data, error: undefined, loading: false });
      })
      .catch((err: unknown) => {
        if (id !== epoch.current) return;
        if (ac.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        setState((s) => ({ ...s, error: msg, loading: false }));
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    const cancel = run();
    return cancel;
  }, [run]);

  useEffect(() => {
    if (!refreshMs || refreshMs <= 0) return;
    const id = setInterval(() => {
      // Only poll while the tab is visible — avoids piling up useless
      // requests when the user has the page open in a background tab.
      if (typeof document !== "undefined" && document.hidden) return;
      run();
    }, refreshMs);
    return () => clearInterval(id);
  }, [run, refreshMs]);

  const refresh = useCallback(() => {
    run();
  }, [run]);

  return { ...state, refresh };
}
