import { monitorEventLoopDelay, type IntervalHistogram } from "perf_hooks";

/**
 * event-loop-lag.ts — process-wide event-loop-delay histogram (RM-DASH 2026-05-29,
 * audit Fix 7). Exposes `perf_hooks.monitorEventLoopDelay()` percentiles so the
 * health watchdog can detect a wedge proactively and we can verify the stampede fix
 * in prod.
 *
 * ONE histogram per process, enabled ONCE — NOT per request. It is created+enabled
 * at startup in `server.js` and stashed on `globalThis`; this module reads that same
 * instance (the custom server + the Next route handlers share one Node process). The
 * lazy fallback below creates+enables it on first read if `server.js` didn't (e.g.
 * under `next start`), guarded so it's still a singleton. The histogram is cumulative
 * since enablement (`max` captures any wedge spike permanently; the Phase-5 stampede
 * test runs against a freshly-restarted process so its window is clean).
 *
 * perf_hooks is a Node built-in sampling at `resolution` ms — it cannot wedge the loop.
 */

const GLOBAL_KEY = "__trevorEloopDelay";

interface LagGlobal {
  [GLOBAL_KEY]?: IntervalHistogram;
}

/** The shared histogram. Created+enabled exactly once (idempotent via globalThis). */
function getHistogram(): IntervalHistogram {
  const g = globalThis as unknown as LagGlobal;
  let h = g[GLOBAL_KEY];
  if (!h) {
    h = monitorEventLoopDelay({ resolution: 10 });
    h.enable();
    g[GLOBAL_KEY] = h;
  }
  return h;
}

export interface EventLoopLag {
  mean_ms: number;
  p50_ms: number;
  p99_ms: number;
  max_ms: number;
}

const NS_PER_MS = 1e6;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Current event-loop-delay percentiles in milliseconds. perf_hooks reports
 * nanoseconds; values are converted + rounded. Before the first sample lands the
 * histogram can report NaN/sentinel values — those are coerced to 0. Wrapped so a
 * reporting hiccup can never break the health probe.
 */
export function getEventLoopLag(): EventLoopLag {
  try {
    const h = getHistogram();
    const safe = (v: number) => (Number.isFinite(v) && v >= 0 ? round2(v / NS_PER_MS) : 0);
    return {
      mean_ms: safe(h.mean),
      p50_ms: safe(h.percentile(50)),
      p99_ms: safe(h.percentile(99)),
      max_ms: safe(h.max),
    };
  } catch {
    return { mean_ms: 0, p50_ms: 0, p99_ms: 0, max_ms: 0 };
  }
}
