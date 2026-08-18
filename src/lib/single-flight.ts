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
  /**
   * B2 (2026-08-17): absolute staleness CEILING in ms — the age past which this cache
   * REFUSES to serve a stale value at all. Per-call override via
   * `swr(..., { stalenessCeiling })`. Default `DEFAULT_STALENESS_CEILING_MS` (30 min).
   * 🚨 It must never be set BELOW the instance's TTL: a ceiling under the TTL can only
   * ever be crossed by an already-expired entry, which silently turns the route into
   * `staleWhileRevalidate:false` — disabling SWR inside what looks like a hardening
   * option. The floor is 2× TTL. See the block above `swr()` for what happens past it.
   */
  stalenessCeiling?: number;
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
   * - B2: past `stalenessCeiling` → the entry is treated as COLD (see below).
   * `compute(prev)` receives the current cached value (the stale one on a refresh,
   * `undefined` when cold) so callers can fill gaps from the prior payload.
   */
  swr(
    key: string,
    compute: (prev: T | undefined) => Promise<T>,
    opts?: { ttl?: number; staleWhileRevalidate?: boolean; stalenessCeiling?: number },
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

/**
 * B2-RM-PROFIT: materiality floor for the SERVING-STALE trace below. A served
 * value is only worth a line once it is well past its own TTL — under a normal
 * poll every expired hit is a serve-stale by design and logging those buries
 * the one that matters. 3× TTL, floored at 60s, so a 10s-TTL route stays quiet
 * at 30s and speaks up at a minute; the 23h07m case is ~1,380× over.
 */
const STALE_SERVE_LOG_TTL_MULT = 3;
const STALE_SERVE_LOG_MIN_MS = 60_000;

/**
 * B2 (2026-08-17): THE GENEROUS DEFAULT STALENESS CEILING — 30 minutes.
 *
 * Not a round number picked for looks: it is `REPLICA_STALE_S` from `replica-age.tsx`
 * (30 * 60), the age past which this repo's replica surfaces ALREADY refuse to render a
 * reading at all. A cache serving a payload older than that is handing consumers something
 * the freshness layer one floor up would have declined to show. One definition of "too old
 * to be a reading", reused rather than re-invented.
 *
 * 26 routes share this cache, so the default is deliberately LOOSE — the ssh-vm-backed
 * routes pass their own tight value. A ceiling too tight would turn a working dashboard
 * into an awaited refresh on every idle visit, which is a different kind of wrong.
 */
export const DEFAULT_STALENESS_CEILING_MS = 30 * 60_000;

export function createSwrCache<T>(options?: SwrCacheOptions): SwrCache<T> {
  const defaultTtl = options?.defaultTtl ?? 30_000;
  const defaultCeiling = options?.stalenessCeiling ?? DEFAULT_STALENESS_CEILING_MS;
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
    opts?: { ttl?: number; staleWhileRevalidate?: boolean; stalenessCeiling?: number },
  ): Promise<SwrResult<T>> {
    const ttl = opts?.ttl ?? defaultTtl;
    const allowStale = opts?.staleWhileRevalidate ?? true;
    const ceiling = opts?.stalenessCeiling ?? defaultCeiling;
    const entry = store.get(key);

    if (entry && clock() - entry.ts < ttl) {
      // Fresh hit — no refresh.
      return { value: entry.value, stale: false, ts: entry.ts };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 🚨 B2 (2026-08-17) — THE ABSOLUTE STALENESS CEILING. THE CACHE NOW REFUSES.
    //
    // Everything below this point used to be unreachable for a warm key: with an
    // entry present, the SWR branch resolved with the stale value and NEVER threw,
    // so a route's `unknown()` / fail-soft contract could only be reached on a COLD
    // cache. Measured on this box 2026-08-17 (WSL, TrevorHub): `/api/health/loops`
    // served a payload built 3h14m earlier at HTTP 200 / status "ok" / source
    // "vm-live", reporting `age_sec: 2107` while the live VM row's true age was
    // 2968s and its iteration count had moved 326 -> 329. `auto-config` served a
    // 19h49m-old payload; `list` (chroma) 19h48m. Nothing failed. Nothing 500'd.
    //
    // 🚨 PAST THE CEILING THE ENTRY IS TREATED AS COLD — IT DOES NOT THROW. That
    // distinction is load-bearing and it is what the measurement decided. The live
    // trigger was NOT a dead upstream: it was an IDLE GAP. Nobody called the route
    // for hours, the entry simply aged, and the background refresh then succeeded
    // on the very next request. Throwing here would convert a recoverable cold
    // start into a false outage on a healthy system. Falling through to the
    // existing awaited single-flight refresh means a healthy upstream returns
    // FRESH data (one slower request, the cold-start cost it already pays) and the
    // route's UNKNOWN contract is reached ONLY when that refresh actually fails.
    //
    // The error that reaches the caller is the REFRESH's own error, deliberately
    // unwrapped: "ssh to vm timed out after 20s" is the reason a human needs, and
    // wrapping it in cache plumbing would bury the cause to advertise the guard.
    // The refusal is named in the log line below instead.
    // ─────────────────────────────────────────────────────────────────────────
    const ceilingExpired = entry !== undefined && clock() - entry.ts > ceiling;
    if (ceilingExpired && entry) {
      console.warn(
        `[swr] REFUSING STALE key="${key}": value is ${clock() - entry.ts}ms old ` +
          `(ceiling=${ceiling}ms, ttl=${ttl}ms) — NOT served; awaiting a fresh compute. ` +
          "If that compute fails the caller sees its error, which is the honest answer",
      );
    }

    if (entry && allowStale && !ceilingExpired) {
      // Expired but present → serve stale immediately + ONE background refresh.
      // Single-flight collapses concurrent expired-hits to a single refresh; a
      // failed background refresh is swallowed so the stale value keeps serving
      // (no poison) until a later refresh succeeds.

      // ─────────────────────────────────────────────────────────────────────
      // 🚨 B2-RM-PROFIT (2026-08-14) — THE SERVE ITSELF NOW LEAVES A TRACE.
      //
      // The 2026-06-30 warn below covers a FAILED background refresh. It is not
      // the path that hurt: a caller can be handed an arbitrarily old value on
      // the ordinary SUCCESS path, because this branch returns the stale entry
      // FIRST and refreshes behind it. After a long idle gap the "stale" value
      // is not seconds old, it is however long nobody asked. Measured on this
      // box: /api/auto/state returned a payload built 2026-08-13 09:04:45 when
      // called at 2026-08-14 08:12:30 — 23h07m — with no error, no failure and
      // NOT ONE LINE ANYWHERE. The next call was current, so the incident left
      // no trace at all and could not be diagnosed after the fact.
      //
      // ⚠️ MATERIALITY GATE, STATED RATHER THAN HIDDEN. The ruling was "log
      // every serve-stale with its age". Taken literally that is every expired
      // hit — with a 10s TTL under a 15s client poll that is EVERY poll, ~4
      // lines/min/route across 26 caches, and a journal nobody can read is how
      // this box's real alert surface gets muted. So an ordinary sub-materiality
      // serve (the designed SWR behaviour, and not a finding) is not logged;
      // anything meaningfully beyond the TTL is, immediately and by name. If
      // the intent was truly every hit, this constant is the one line to change.
      // ─────────────────────────────────────────────────────────────────────
      const servedAgeMs = clock() - entry.ts;
      if (servedAgeMs > Math.max(STALE_SERVE_LOG_MIN_MS, ttl * STALE_SERVE_LOG_TTL_MULT)) {
        console.warn(
          `[swr] SERVING STALE key="${key}": value is ${servedAgeMs}ms old (ttl=${ttl}ms) — ` +
            "returned to the caller as-is while a background refresh runs; any freshness " +
            "figure inside this payload was measured when it was built, not now",
        );
      }

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

    // Cold, OR expired with staleWhileRevalidate:false, OR past the B2 ceiling →
    // await a single-flighted refresh (concurrent callers still share ONE compute).
    // A rejection propagates. `compute(prev)` still receives the stale value on the
    // ceiling path, exactly as it already does on the staleWhileRevalidate:false
    // path — this reuses an existing branch rather than minting a new one.
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
