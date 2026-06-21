/**
 * hl-deposits.ts — lifetime HL net-deposits base for the Auto Capital realized-%.
 *
 * BASE-B1 (2026-06-20). The realized-P&L % on the Auto Capital card now divides
 * EVERY window's realized P&L by ONE fixed base = total lifetime NET DEPOSITS (all
 * capital in − all capital out, ever), replacing the old per-window
 * start-of-window equity base (WA-P1). The old base shifted window-to-window and
 * could exceed −100% (impossible vs real capital); the lifetime base is fixed, so
 * TODAY and YESTERDAY read consistently for equal dollar P&L. That true figure is
 * NOT stored anywhere (the $50 seed, $70.91 earliest snapshot, etc. are all
 * provably incomplete) — it must be read from Hyperliquid's deposit/withdrawal
 * ledger.
 *
 * SOURCE — the HL public info endpoint `userNonFundingLedgerUpdates` (POST). It
 * needs only the PUBLIC wallet address (never the private key). The Hub box has no
 * `hyperliquid` module and no HL creds, so this is a direct `fetch` of the public
 * endpoint — the SAME pattern as `src/app/api/prices/route.ts`. This box reaches
 * api.hyperliquid.xyz directly (proven HTTP 200). The address is read from
 * `HL_WALLET_ADDRESS` (env / `.env.local`; public, fail-open if absent).
 *
 * lifetime_net_deposits = Σ(deposit.usdc) − Σ(withdraw.usdc). Internal moves are
 * NOT new capital and are EXCLUDED: `accountClassTransfer` (own perp↔spot) and
 * `spotTransfer` (token move to another address). Confirmed against the live
 * ledger 2026-06-20: 5 deposits $153.36 − 1 withdraw $31.18 = $122.18.
 *
 * BASE-B3 (cache + fail-open): a module-level createSwrCache, 1h TTL (deposits
 * change ~monthly), staleWhileRevalidate so a failed refresh serves the last-good
 * value instead of poisoning. `fetchLifetimeNetDeposits()` THROWS on ANY failure
 * (missing/bad address, network/HTTP/timeout, non-array body, no deposit events,
 * non-positive net) so the cache never stores a wrong/zero base; the public
 * `getLifetimeNetDeposits()` catches → returns `null`. `null` = "base unavailable"
 * → the consumer renders the % as "—", NEVER a wrong number off a fallback base.
 * This is money-path display: a missing base is better than a wrong base.
 */
import { createSwrCache } from "@/lib/single-flight";

const HL_INFO_URL = "https://api.hyperliquid.xyz/info";
const FETCH_TIMEOUT_MS = 5_000;
// 1h: deposits change ~monthly, so a long TTL keeps the call off the hot path.
// staleWhileRevalidate (default) serves the last-good figure while one background
// refresh runs; a failed refresh keeps serving stale (no poison).
const DEPOSITS_TTL_MS = 60 * 60 * 1000;
// Mirrors query_auto_state.EQUITY_BASE_FLOOR (1.0): a base at/below this is treated
// as unavailable so the % is never divided by ~0.
const BASE_FLOOR_USD = 1.0;

interface LedgerDelta {
  type?: string;
  usdc?: string | number;
}
interface LedgerUpdate {
  delta?: LedgerDelta;
}

const depositsCache = createSwrCache<number>({
  defaultTtl: DEPOSITS_TTL_MS,
  concurrency: 1,
});

/** Parse the HL `usdc` field (a string in the API) to a finite number, else 0. */
function toUsd(v: string | number | undefined): number {
  const n = typeof v === "number" ? v : parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fetch the HL ledger and sum lifetime net deposits. THROWS on any failure so the
 * cache never stores a bad/zero base — `getLifetimeNetDeposits()` turns a throw
 * into a fail-open `null`.
 */
async function fetchLifetimeNetDeposits(): Promise<number> {
  const addr = process.env.HL_WALLET_ADDRESS?.trim();
  if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new Error("HL_WALLET_ADDRESS unset or malformed");
  }
  const res = await fetch(HL_INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "userNonFundingLedgerUpdates", user: addr }),
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HL ledger HTTP ${res.status}`);
  const body: unknown = await res.json();
  if (!Array.isArray(body)) throw new Error("HL ledger body not an array");

  let deposits = 0;
  let withdrawals = 0;
  let depositCount = 0;
  for (const ev of body as LedgerUpdate[]) {
    const d = ev?.delta;
    if (!d || typeof d.type !== "string") continue;
    // deposit/withdraw ONLY. accountClassTransfer (own perp↔spot) + spotTransfer
    // (token move) are internal/non-USDC-capital and are EXCLUDED.
    if (d.type === "deposit") {
      deposits += toUsd(d.usdc);
      depositCount += 1;
    } else if (d.type === "withdraw") {
      withdrawals += toUsd(d.usdc);
    }
  }
  // No deposit events at all ⇒ the ledger read is wrong/empty, not a real $0 base.
  if (depositCount === 0) throw new Error("HL ledger has no deposit events");
  const net = deposits - withdrawals;
  if (!(net > BASE_FLOOR_USD)) {
    throw new Error(`HL net deposits at/below floor (${net})`);
  }
  return net;
}

/**
 * Lifetime net deposits (USD), cached 1h, fail-open. Returns the dollar figure, or
 * `null` when the base is unavailable (no/bad address · HL unreachable · parse
 * failure · cold-start failure). `null` → the consumer renders the realized-% as
 * "—". NEVER falls back to a stored proxy ($50 seed / $70.91 snapshot) — a wrong
 * base is worse than no base on a money-path display.
 */
export async function getLifetimeNetDeposits(): Promise<number | null> {
  try {
    const { value } = await depositsCache.swr(
      "net-deposits",
      fetchLifetimeNetDeposits,
      { ttl: DEPOSITS_TTL_MS },
    );
    return value;
  } catch {
    return null;
  }
}
