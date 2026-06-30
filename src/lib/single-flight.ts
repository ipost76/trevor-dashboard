/**
 * single-flight.ts — single-flight dedup + stale-while-revalidate + per-origin
 * concurrency cap. One reusable cache so routes wire to it instead of copy-pasting
 * a module-level `inFlight` into 7 files.
 *
 * WHY (2026-05-29 RM-DASH residual-wedge wave): the outbound-`fetch()` routes
 * (`/api/prices`, `/api/heartbeat`) and the `runPython`-cached routes
 * (`trade-stats`, `nav-badges`, `time-slots`, `commits`, `quality`) all had a
 * read-through cache but NO in-flight dedup and NO concurrency cap — the cache
 * was written only AFTER the full miss-chain completed, so during the miss window
 * every concurrent request launched its own independent upstream chain. A bounded
 * set of synchronized client pollers amplified into an UNBOUNDED set of concurrent
 * fetch/spawn chains at each cache-expiry boundary → cache-stampede → metastable
 * failure (sync JSON.parse bursts, undici socket saturation, timer/GC pressure).
 * See docs/audits/RESIDUAL_WEDGE_AUDIT.md.
 *
 * THREE LOAD-BEARING PARTS:
 *   1. Single-flight: concurrent callers for the same key await the SAME promise;
 *      the key's promise clears in `.finally()`. K upstream chains → 1 per key/window.
 *   2. Stale-while-revalidate: on expiry, return the stale value immediately AND
 *      kick off ONE background refresh (guarded by single-flight). Cold cache (no
 *      value at all) awaits — can't serve nothing.
 *   3. Per-origin concurrency cap: an in-file counting semaphore bounds concurrent
 *      refreshes per cache instance (= per logical origin) to a small K. Belt-and-
 *      suspenders behind single-flight; bounds pathological mixed-key cases.
 *
 * ERROR DISCIPLINE: a failed refresh (a) clears the in-flight promise so the next
 * caller retries (no permanent poison), (b) NEVER overwrites the cached value (the
 * store is written only on success), and (c) surfaces the error to a cold-cache
 * awaiter while letting SWR callers keep serving the stale value.
 *
 * No external dependencies — pure, unit-testable, with an injectable clock.
 */

/** What `swr()` resolves to. `stale` is true only while serving an expired value
 *  during a background revalidation. `ts` is the epoch-ms time `value` was produced. */
export interface SwrResult<T> {
  value: T;
  stale: boolean;
  ts: number;
}

interface CacheEntry<T> {
  value: T;
  ts: number;
}

export interface SwrCacheOptions {
  /** Default TTL in ms (per-call override available via `swr(..., { ttl })`). Default 30_000. */
  defaultTtl?: number;
  /** Max concurrent refreshes for this cache instance (per-origin cap K). Default 2. */
  concurrency?: number;
  /** Injectable monotonic-ish clock (ms). Default `() => Date.now()`. Override in tests. */
  clock?: () => number;
}

export interface SwrCache<T> {
  /**
   * Read-through with single-flight + (optional) stale-while-revalidate.
   * - fresh (age < ttl)         → returns cached value, `stale:false`, no refresh.
   * - expired (value present):
   *     · `staleWhileRevalidate` (default true) → returns the stale value immediately,
   *       `stale:true`, and fires ONE background refresh (single-flight-guarded). A
   *       failed background refresh is swallowed (keeps serving stale, no poison).
   *     · `staleWhileRevalidate:false` → AWAITS a single-flighted refresh and returns
   *       the fresh value (`stale:false`); a `compute` rejection SURFACES to the caller.
   *       Use this when staleness is unacceptable (e.g. a live proxy whose UI must show
   *       upstream errors) but same-tick bursts should still collapse to one upstream call.
   * - cold (no value)           → awaits the refresh; rejects if `compute` rejects.
   * `compute(prev)` receives the current cached value (the stale one on a refresh,
   * `undefined` when cold) so callers can fill gaps from the prior payload.
   */
  swr(
    key: string,
    compute: (prev: T | undefined) => Promise<T>,
    opts?: { ttl?: number; staleWhileRevalidate?: boolean },
  ): Promise<SwrResult<T>>;
  /** Non-mutating inspection of the cached entry (no compute). `stale` is judged
   *  against `defaultTtl`. Returns undefined when there is no value. */
  peek(key: string): SwrResult<T> | undefined;
  /** Drop all cached values + in-flight handles (does not abort running computes). */
  clear(): void;
}

/**
 * A minimal counting semaphore — no busy-wait, no external dependency. On release
 * the slot is handed DIRECTLY to the next waiter (rather than incrementing then
 * racing to re-acquire), so the cap is honoured under contention.
 */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(max: number) {
    if (!Number.isInteger(max) || max < 1) {
      throw new Error(`Semaphore max must be a positive integer, got ${String(max)}`);
    }
    this.available = max;
  }

  /** Acquire a slot, run `fn`, and release the slot whether `fn` resolves or throws. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the held slot straight to the next waiter — do NOT increment
      // `available`, or a fresh acquire() could steal the slot first.
      next();
    } else {
      this.available += 1;
    }
  }
}

export function createSwrCache<T>(options?: SwrCacheOptions): SwrCache<T> {
  const defaultTtl = options?.defaultTtl ?? 30_000;
  const clock = options?.clock ?? (() => Date.now());

  const store = new Map<string, CacheEntry<T>>();
  const inFlight = new Map<string, Promise<T>>();
  const semaphore = new Semaphore(options?.concurrency ?? 2);

  /** Single-flight + semaphore-capped refresh. Writes the store ONLY on success;
   *  clears the in-flight handle on settle (success OR failure) so retries work. */
  function refresh(key: string, compute: (prev: T | undefined) => Promise<T>): Promise<T> {
    const existing = inFlight.get(key);
    if (existing) return existing;

    const prev = store.get(key)?.value;
    const p = semaphore
      .run(() => compute(prev))
      .then((value) => {
        // Success only — a thrown compute never reaches here, so it can't poison.
        store.set(key, { value, ts: clock() });
        return value;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, p);
    return p;
  }

  async function swr(
    key: string,
    compute: (prev: T | undefined) => Promise<T>,
    opts?: { ttl?: number; staleWhileRevalidate?: boolean },
  ): Promise<SwrResult<T>> {
    const ttl = opts?.ttl ?? defaultTtl;
    const allowStale = opts?.staleWhileRevalidate ?? true;
    const entry = store.get(key);

    if (entry && clock() - entry.ts < ttl) {
      // Fresh hit — no refresh.
      return { value: entry.value, stale: false, ts: entry.ts };
    }

    if (entry && allowStale) {
      // Expired but present → serve stale immediately + ONE background refresh.
      // Single-flight collapses concurrent expired-hits to a single refresh; a
      // failed background refresh is swallowed so the stale value keeps serving
      // (no poison) until a later refresh succeeds.
      void refresh(key, compute).catch((err) => {
        // B1 HEARTBEAT-FAILSAFE (2026-06-30): kill the SILENT keep-stale path —
        // the incident left no Hub trace. A swallowed background-refresh failure
        // now logs the key, the error, and how old the kept value is. Behavior
        // is unchanged (still keep last good, no poison); only the silence is gone.
        const ageMs = clock() - entry.ts;
        console.warn(
          `[swr] background refresh failed for key="${key}": ${String(err)} — ` +
            `keeping stale value (age=${ageMs}ms); cold awaiters are the only ones that see errors`,
        );
      });
      return { value: entry.value, stale: true, ts: entry.ts };
    }

    // Cold, OR expired with staleWhileRevalidate:false → await a single-flighted
    // refresh (concurrent callers still share ONE compute). A rejection propagates.
    const value = await refresh(key, compute);
    const fresh = store.get(key);
    return { value, stale: false, ts: fresh ? fresh.ts : clock() };
  }

  function peek(key: string): SwrResult<T> | undefined {
    const entry = store.get(key);
    if (!entry) return undefined;
    return { value: entry.value, stale: clock() - entry.ts >= defaultTtl, ts: entry.ts };
  }

  function clear(): void {
    store.clear();
    inFlight.clear();
  }

  return { swr, peek, clear };
}
