// KPI-RECON (2026-06-29): the LIVE open-position SET, from the Observatory
// heartbeat — the same source `/api/auto/state` already uses for the AUTO
// CAPITAL header open-count / deployed / floating (W-H-P4-HUB doctrine: open/
// live positions come from the heartbeat, CLOSED history from the litestream
// replica). This lib exists so the ACTIVE-list route (`/api/auto/trades`) can
// read the SAME live membership the header reads, instead of the ~15-min-stale
// replica `auto_trades WHERE status='open'` it used before — which silently
// under-rendered a position opened inside a sync window (e.g. a just-opened
// FARTCOIN showing in the header's "2 open" but not in the ACTIVE list).
//
// The header path (`/api/auto/state`) is intentionally NOT modified — it is
// already live-correct. This is a read-only, additive helper.

import { createSwrCache } from "@/lib/single-flight";

// Same upstream as src/app/api/auto/state/route.ts + src/app/api/hub/drift-state.
const OBSERVATORY_HEARTBEAT_URL =
  "https://trevor-prime-2.tail2bf7a3.ts.net:8443/api/heartbeat";

// One live open position as published by the heartbeat's autotrader category.
// These are the ONLY fields the heartbeat carries per position — notably it does
// NOT carry stop/target/confidence/opened_at/peak/exit_signals_log (those live
// in the replica row and are merged in route-side; a position not yet in the
// replica renders as a "thin" live card).
export interface HeartbeatOpenPosition {
  id: number;
  ticker: string;
  direction: "LONG" | "SHORT";
  entry_price: number;
  leverage: number;
  notional_usd: number;
}

interface RawHeartbeatPosition {
  id?: number | null;
  ticker?: string | null;
  direction?: string | null;
  entry_price?: number | null;
  leverage?: number | null;
  notional_usd?: number | null;
}

interface HeartbeatPayload {
  categories?: {
    autotrader?: {
      open_positions?: RawHeartbeatPosition[] | null;
    };
  };
}

// 10s TTL mirrors the state route's equity cache so the live open-set the ACTIVE
// list reads is as fresh as the header's open-count, and concurrent ticks from
// both cards collapse to ONE upstream heartbeat fetch.
const OPEN_SET_POLL_TTL_MS = 10_000;
const cache = createSwrCache<HeartbeatOpenPosition[]>({
  defaultTtl: OPEN_SET_POLL_TTL_MS,
  concurrency: 2,
});

// B1 HEARTBEAT-FAILSAFE (2026-06-30): absolute staleness ceiling — fail SAFE
// (to "I don't know"), never STALE (to "the last thing I saw"). SWR swallows a
// failed background refresh and keeps serving the last-known set forever
// (single-flight.ts) — the exact path that served a CLOSED row (101112) as an
// open −17% HYPE card for hours (NRestarts=0 ⇒ the in-memory cache persisted).
// Past this age since the last *successful* refresh, the getter returns null so
// the caller falls through to the (closed-history-correct) replica instead of a
// stale ghost. 6× the poll TTL = 60s: a 1–2 cycle hiccup still serves slightly-
// stale (fine), a sustained outage expires to null. Complementary to the replica
// cross-check eviction in trades/route.ts (which drops a closed id even while the
// heartbeat is alive) — together they kill the ghost from either angle.
const OPEN_SET_STALENESS_CEILING_MS = 6 * OPEN_SET_POLL_TTL_MS;

// Returns the live open SET, or null when the heartbeat is unavailable so the
// caller can FALL BACK to the replica set (never blank). An empty array is a
// VALID "flat account, 0 open" answer (present-but-empty), distinct from null
// (heartbeat unreachable) — so a genuinely-flat live account correctly clears
// the ACTIVE list even while the replica still lags a just-closed position.
export async function fetchHeartbeatOpenSet(): Promise<
  HeartbeatOpenPosition[] | null
> {
  try {
    const { value, ts } = await cache.swr("heartbeat-open-set", async () => {
      const res = await fetch(OBSERVATORY_HEARTBEAT_URL, {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        // B1: log every failed fetch — kill the silent path the incident left.
        console.warn(
          `[heartbeat-open-set] fetch failed: heartbeat HTTP ${res.status} — swr keeps the last-known set until the ceiling expires it`,
        );
        throw new Error(`heartbeat ${res.status}`);
      }
      const hb = (await res.json()) as HeartbeatPayload;
      const raw = hb?.categories?.autotrader?.open_positions;
      // Absent/null ⇒ throw so swr keeps serving the last-known set (and a cold
      // miss surfaces as the catch below → null → replica fallback). A present
      // empty array is a legitimate "0 open" and passes through.
      if (!Array.isArray(raw)) {
        // B1: log every failed fetch — kill the silent path the incident left.
        console.warn(
          "[heartbeat-open-set] fetch failed: open_positions absent — swr keeps the last-known set until the ceiling expires it",
        );
        throw new Error("open_positions absent");
      }
      const seen = new Set<number>();
      const positions: HeartbeatOpenPosition[] = [];
      for (const p of raw) {
        // Dedup on the unique id PK (phantom-bleeder law) — one trade can never
        // inflate the count. Drop rows without a numeric id (can't be merged).
        if (typeof p?.id !== "number" || seen.has(p.id)) continue;
        seen.add(p.id);
        positions.push({
          id: p.id,
          ticker: typeof p.ticker === "string" ? p.ticker : "",
          direction: p.direction === "SHORT" ? "SHORT" : "LONG",
          entry_price:
            typeof p.entry_price === "number" && Number.isFinite(p.entry_price)
              ? p.entry_price
              : 0,
          leverage:
            typeof p.leverage === "number" && Number.isFinite(p.leverage)
              ? p.leverage
              : 0,
          notional_usd:
            typeof p.notional_usd === "number" && Number.isFinite(p.notional_usd)
              ? p.notional_usd
              : 0,
        });
      }
      return positions;
    });
    // B1: enforce the absolute staleness ceiling. `ts` is the epoch-ms of the
    // last *successful* refresh (single-flight writes the store only on success),
    // so a swallowed-background-refresh stale serve carries an OLD ts. Past the
    // ceiling, fail SAFE to null → caller (trades/route.ts) falls through to the
    // replica set instead of rendering a stale ghost.
    const age = Date.now() - ts;
    if (age > OPEN_SET_STALENESS_CEILING_MS) {
      console.warn(
        `[heartbeat-open-set] EXPIRING stale set: age=${age}ms > ceiling=${OPEN_SET_STALENESS_CEILING_MS}ms ` +
          "(last successful refresh too old) — returning null for replica fallback",
      );
      return null;
    }
    return value;
  } catch (err) {
    // Heartbeat unreachable / cold-miss failure ⇒ null ⇒ caller keeps the
    // replica set (never invents an empty live answer that would blank the list).
    // B1: log the cold-miss too so the failure never goes untraced.
    console.warn(
      `[heartbeat-open-set] cold-miss/unreachable: ${String(err)} — returning null for replica fallback`,
    );
    return null;
  }
}
