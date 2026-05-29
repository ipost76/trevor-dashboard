# Residual Event-Loop Wedge Audit — `/api/prices` (outbound-fetch) class

> **Status:** read-only recon. **No code changed.** Proposed fixes below are *proposals only* — awaiting go-ahead.
> **Date:** 2026-05-29 · **Repo:** `trevor-dashboard` (`master`) · **Author:** CC (Hub session)
> **Scope:** the outbound-`fetch()` route class (`/api/prices` and siblings). The Python bridge is explicitly **out of scope** — see §2.

---

## 0. TL;DR

- The 2026-05-29 async-bridge wave fixed the **Python-bridge** wedge. It did **not** touch the **outbound-`fetch()`** routes, which are a separate class and the residual wedge surface.
- **Root cause:** the fetch routes have a **read-through cache but no in-flight dedup (single-flight) and no per-route/per-origin concurrency cap.** A *bounded* set of client pollers amplifies into an *unbounded* set of concurrent upstream fetch-chains every time the cache is cold or expired, or whenever an upstream slows. This is a classic **cache-stampede → metastable-failure** loop.
- **Mechanism that presents as an "event-loop wedge":** pure async fetch I/O does **not** block the loop, but the stampede produces three compounding loop-stealers — (a) bursts of **synchronous `JSON.parse`** of Hyperliquid's full `allMids` payload, (b) undici **socket-pool/TLS saturation** to a single origin, and (c) **timer + GC pressure** from hundreds of simultaneous 5 s `AbortSignal.timeout` fetches that all ride their full timeout once the upstream throttles. Once the herd makes the upstream slow, the herd stays large → self-amplifying.
- **Next 15.3.3 upgrade: NOT indicated** (low probability, high churn — see §5).
- **`node --inspect` repro: YES, warranted** before committing a fix, to confirm *which* of (a)/(b)/(c) dominates — the fix differs per cause (see §6 + §7).

---

## 1. Environment (verified)

| Fact | Value | Source |
|---|---|---|
| Runtime | Node **v20.20.0**, npm 10.8.2 | `node -v` |
| `fetch` impl | global undici (Node 20 built-in) | `typeof fetch === "function"` |
| Next.js | **15.3.3** (App Router) | `node_modules/next/package.json` |
| Server | custom `server.js` — single `http.createServer`, single process, `127.0.0.1:3333` | `server.js` |
| Edge | nginx reverse proxy (80/443) → :3333 | `CLAUDE.md` |
| Concurrency model | **one process, one event loop**, no clustering | `server.js` (no `cluster`/`worker_threads`) |

A single shared event loop means any sustained synchronous CPU, GC pause, or I/O-scheduler saturation is felt by **every** route at once — consistent with a "the whole Hub freezes" symptom.

---

## 2. Python bridge — correctly scoped OUT (confirmed non-blocking)

`src/lib/api-helpers.ts` was rewritten async on 2026-05-29 (`spawn` + `detached:true` process-group + `stdio:['pipe','pipe','pipe']` + `AbortController` timeout → `process.kill(-pid,'SIGKILL')`). I read it end-to-end:

- `spawnAsync` resolves on `close`; never reads a pipe synchronously → **cannot block the loop**.
- Timeout SIGKILLs the whole group, so a hung grandchild can't keep the loop waiting.

**Verdict:** the bridge is genuinely non-blocking. The residual wedge is **not** here. This audit does not re-litigate it.

> Adjacent note (not the wedge, flagged for a later pass): the `runPython`-backed *cached* routes (`trade-stats`, `nav-badges`, `time-slots`, `commits`, `quality`) share the **same cache-without-dedup gap** described below — a cold-cache burst spawns N concurrent Python children. Now that the bridge is async this is bounded and non-blocking, so it's lower severity, but it's the same structural omission and worth fixing in the same wave.

---

## 3. The outbound-`fetch()` route class — inventory

Server-side route handlers that make an **outbound network `fetch()`** (the actual wedge surface). `safeFetch` in `src/lib/fetch.ts` is **client-side only** (used in browser components) and is not a server event-loop concern, but see §4.4.

| Route | Upstream(s) | Cache | Timeout | In-flight dedup | Concurrency cap | Notes |
|---|---|---|---|---|---|---|
| **`/api/prices`** | Hyperliquid `allMids` → CoinGecko (fallback) | ✅ 30 s module cache | ✅ 5 s each | ❌ **none** | ❌ **none** | **Primary suspect.** Highest fan-out. Sequential HL→CG (up to ~10 s/miss). Synchronous parse of full `allMids` per miss. |
| **`/api/heartbeat`** | local Observatory `:3335` (proxy) | ❌ **none** | ✅ 5 s (GET) / 10 s (POST) | ❌ **none** | ❌ **none** | `force-dynamic`, every hit proxies upstream. Lower fan-out (only `/memory?tab=health`). |
| `/api/trades/edit-entry` | Discord REST (PATCH card) | n/a | ❌ **none** | n/a | ❌ **none** | POST write, low frequency. Discord `fetch` has **no AbortSignal** → a slow Discord API holds the request open. Minor, but real. |

`grep -rn "fetch(" src/app/api --include=route.ts` → exactly these three files. No other route makes an outbound fetch.

---

## 4. Root cause — detail

### 4.1 The stampede (the core defect)

`src/app/api/prices/route.ts`:

```
let cache: {...} | null = null;            // module-level
...
if (cache && Date.now() - cache.ts < 30_000) { return cache; }   // HIT
...                                                              // MISS:
const hl = await fetchHyperliquid();        // up to 5 s
const cg = await fetchCoinGecko(missing);   // then up to 5 s more
...
cache = { ..., ts: Date.now() };            // cache written ONLY at the very end
return ...;
```

The cache is written **after** the full miss-chain completes. So during the entire miss window (up to ~10 s), **every** concurrent request still evaluates the cache as stale and launches **its own** independent HL+CG chain. There is no `inFlight` promise for arrivals to await. Result: a burst of K simultaneous requests → K upstream chains, not 1.

### 4.2 Client fan-out makes bursts synchronized, not random

The pollers are aligned to round intervals, so they **cluster on the same tick** rather than spreading out:

| Component | Route | Interval | Surface |
|---|---|---|---|
| `PriceStrip` | `/api/prices?tickers=<10>` | **30 s** | global (header — every page) |
| `watchlist-grid` | `/api/prices?tickers=<10>` | **30 s** | `/autotrader` |
| `active-position-card` | `/api/prices?tickers=<10>` | **15 s** | `/autotrader` |

One open `/autotrader` tab = **3 pollers**; the 15 s and 30 s cadences **re-align every 30 s**, firing simultaneously. Each browser tab and each device multiplies this. Because the responses carry no `Cache-Control` and the route is `force-dynamic`, **nginx does not coalesce** them either — every poll reaches Node. N tabs × aligned ticks → a synchronized burst straight into the un-deduped miss path at each 30 s cache-expiry boundary.

### 4.3 Why a *non-blocking* fetch path still presents as a wedge

Async fetch I/O alone doesn't block the loop. The stampede converts it into loop-pressure three ways:

1. **Synchronous `JSON.parse` bursts.** `await res.json()` buffers then parses **synchronously**. Hyperliquid `allMids` is the full perp mids map (~200+ symbols). With dedup absent, every miss parses the whole payload and runs `Object.entries(...)` over it. A synchronized burst queues N back-to-back synchronous parses on the one loop → contiguous multi-ms blocking spikes that scale with herd size.
2. **undici socket / TLS saturation.** The global dispatcher pools per origin. A herd of identical requests to `api.hyperliquid.xyz` / `api.coingecko.com` opens/queues many sockets + TLS handshakes. CoinGecko's free tier rate-limits aggressively (HTTP 429) under a burst from one IP; throttled chains then ride the **full 5 s timeout**.
3. **Timer + AbortController + GC pressure.** Each in-flight fetch holds an `AbortSignal.timeout(5000)` timer, an `AbortController`, and response buffers. When upstreams slow, the in-flight set **grows faster than it drains** (arrivals every tick, each pinned for 5 s). Memory + timer-heap + GC churn climb; GC pauses lengthen; the loop appears wedged.

**This is a metastable failure:** crossing the load threshold makes the upstream slow, which keeps the herd large, which keeps the upstream slow. It clears only when client load drops — matching "reproduces under heavy concurrent fetch-route load."

### 4.4 Minor adjacent gaps (not the primary wedge, flag-only)

- `src/lib/fetch.ts:safeFetch` does `await fetch(url)` with **no AbortSignal** — a hung `/api/*` upstream leaves the *browser* component awaiting indefinitely. Client-side, not the server wedge, but worth a timeout.
- `/api/trades/edit-entry` Discord PATCH has no timeout (see §3).
- `/api/heartbeat` has **no cache at all** — every poll proxies the Observatory. Lower fan-out today, but the same single-flight fix applies.

---

## 5. Is a Next 15.3.3 upgrade needed? — **No (not indicated)**

- The wedge mechanism lives in **application code** (missing dedup/cap) + **undici** (Node's fetch), **not** in Next's request pipeline. These are plain App Router route handlers; the defect reproduces independent of Next internals.
- There is **no known Next 15.3.x event-loop bug** matching this signature. 15.3.3 is current.
- These routes are `force-dynamic` with `cache:"no-store"`/no-cache reads, so Next's patched-`fetch` caching layer is pass-through here — an upgrade wouldn't change the path.
- An upgrade is **high-churn, low-probability** as a fix and would muddy attribution. **Recommend against** as the primary lever. Revisit only if a `--inspect` profile points at Next/undici framework frames (unlikely).

---

## 6. Is a `node --inspect` repro needed? — **Yes (do this first)**

Static reading establishes the **structural defect** (no dedup/cap) with high confidence, but **cannot prove which loop-stealer dominates** (§4.3 a vs b vs c). The fix differs per cause:

- If **(a) synchronous parse** → dedup + parse-once is the whole fix.
- If **(b) socket saturation** → add a per-origin concurrency cap / dispatcher tuning.
- If **(c) GC/timer pressure** → dedup collapses the in-flight set; confirm heap stabilizes.

So profile **before** committing. Suggested repro (run against a non-prod instance, or prod off-hours with care):

```bash
# 1. Start the Hub under the inspector + CPU profile, with event-loop-lag sampling.
#    (server.js is the entrypoint; NODE_OPTIONS injects the inspector.)
NODE_OPTIONS="--inspect --cpu-prof --cpu-prof-dir=/tmp/wedge-prof" node server.js

# 2. In a second shell, add an event-loop-lag probe (or expose perf_hooks.monitorEventLoopDelay
#    via /api/health temporarily). Then drive a synchronized cold-cache herd at /api/prices:
#    (autocannon or hey; force cache-miss by spacing bursts > 30 s apart)
npx autocannon -c 100 -d 60 -R 0 \
  "http://127.0.0.1:3333/api/prices?tickers=BTC,ETH,SOL,HYPE,FARTCOIN,XRP,DOGE,NEAR,SUI,kPEPE"

# 3. Capture: CPU profile (long JSON.parse tasks?), event-loop p99 lag, RSS/heap growth,
#    and undici socket counts. Then attach Chrome DevTools to the --inspect port for the
#    flamegraph if the .cpuprofile isn't conclusive.
```

What to look for:
- **Long tasks in `JSON.parse` / `Object.entries`** → confirms (a).
- **High event-loop lag with low CPU + many open sockets** → confirms (b).
- **Sawtooth RSS + lengthening GC pauses** → confirms (c).
- **Latency cliff exactly at 30 s cache-expiry boundaries** → confirms the stampede framing regardless.

A lightweight alternative if `--inspect` on prod is undesirable: temporarily expose `perf_hooks.monitorEventLoopDelay()` percentiles on `/api/health` (Python-free, already the watchdog's probe) and watch p99 lag spike under load — enough to confirm the wedge without a full profiler.

---

## 7. Proposed fixes (PROPOSALS ONLY — none applied)

Ordered by leverage-to-risk. **Fix 1 alone is expected to eliminate the wedge**; the rest are defense-in-depth.

### Fix 1 — In-flight dedup (single-flight) on `/api/prices` and `/api/heartbeat` ★ highest leverage
Module-level `inFlight: Promise | null`. Concurrent misses **await the same promise** instead of each launching a chain. Collapses K upstream chains → **1** per cache-key per window. Smallest change, kills the stampede at the source.
```
let inFlight: Promise<PricePayload> | null = null;
async function refresh(tickers) {
  if (inFlight) return inFlight;            // join the in-flight refresh
  inFlight = doFetch(tickers).finally(() => { inFlight = null; });
  return inFlight;
}
```
*(Note the per-ticker-set subtlety: callers all request the same 10-ticker list, so a single shared in-flight keyed on the canonical superset is sufficient. Verify before implementing — if arbitrary ticker subsets are possible, key the in-flight map by normalized ticker set.)*

### Fix 2 — Serve-stale-while-revalidate
On expiry, **return the stale cache immediately** and refresh in the background (guarded by Fix 1's single-flight). Removes the latency cliff at the 30 s boundary entirely. Clients already render `stale:true`, so this is behavior-compatible.

### Fix 3 — Per-origin concurrency cap (backstop)
A tiny counting semaphore (no new dep needed) limiting concurrent upstream calls per origin to a small K. With Fix 1 this is effectively belt-and-suspenders, but it bounds pathological cases (e.g. mixed ticker sets, future routes).

### Fix 4 — Parallelize independent upstream calls
HL→CG is sequential today (CG only fills HL misses, so it's conditional — keep as-is once deduped). Flagged only so a future multi-source fetch doesn't serialize unnecessarily.

### Fix 5 — Edge micro-cache (nginx `proxy_cache`, 5–10 s) for `/api/prices`
Collapses **cross-tab / cross-device** herds at the edge before they ever reach Node. Out of repo (`/etc/nginx`), defense-in-depth. Requires adding a short `Cache-Control`/`proxy_cache_valid` — coordinate so it doesn't mask `stale` semantics.

### Fix 6 — Timeouts on the stragglers
Add `AbortSignal.timeout(...)` to `safeFetch` (client) and to the `/api/trades/edit-entry` Discord PATCH. Minor, but removes two unbounded-wait paths.

### Fix 7 — Event-loop-lag observability
Expose `perf_hooks.monitorEventLoopDelay()` p99 on `/api/health` so the health watchdog can detect a wedge **proactively** (and so we can verify the fix in prod). Cheap, high diagnostic value.

### Fix 8 (adjacent, separate wave) — same dedup gap on the `runPython`-cached routes
`trade-stats`, `nav-badges`, `time-slots`, `commits`, `quality` cache-without-dedup → cold-cache bursts spawn N Python children. Non-blocking now (async bridge) but same omission; fold into the dedup helper from Fix 1.

---

## 8. Suggested sequence (on go-ahead)

1. **Confirm** with the `--inspect` / event-loop-lag repro (§6) — establishes the dominant cause and a before-number.
2. Implement **Fix 1 + Fix 2** (single-flight + stale-while-revalidate) on `/api/prices`, then `/api/heartbeat`. Re-run the repro — expect the in-flight set to collapse to 1/window and the p99 lag spike to vanish.
3. Add **Fix 7** (lag metric on `/api/health`) to lock in regression detection.
4. Optionally **Fix 3 / Fix 5 / Fix 6** as defense-in-depth, and schedule **Fix 8** as a follow-up wave.
5. **Next upgrade: do not pursue** unless the profile implicates framework frames.

---

## 9. Honesty / confidence notes

- **High confidence (static-verified):** the dedup/cap omission, the client fan-out cadence, the sequential HL→CG path, the synchronous-parse cost, that the Python bridge is non-blocking, and that nginx does not coalesce these responses today.
- **Inferred (not yet measured):** the *relative* contribution of synchronous-parse vs socket-saturation vs GC pressure to the observed freeze. That's exactly what §6 confirms — hence "profile before fixing."
- **Not reproduced in this session** (read-only recon, no load test run). No service touched, no restart, no code changed. The repro recipe in §6 is the proposed confirmation step, not something already executed.
