"use client";

/**
 * Hyperliquid live-mark WebSocket store (RM-LIVE Wave B — B1, 2026-06-18).
 *
 * A lazy, subscriber-counted singleton that subscribes to Hyperliquid's public
 * `allMids` WebSocket feed and exposes live marks to React via `useLiveMark`.
 *
 * ── DORMANT BY DESIGN ────────────────────────────────────────────────────────
 * The WebSocket opens ONLY when the first component subscribes (a `useLiveMark`
 * call with `enabled === true`) and closes when the last subscriber leaves. With
 * ZERO subscribers — the state the instant this lands, since nothing imports it
 * yet — NO socket is ever opened. `new WebSocket(...)` lives inside `subscribe()`,
 * never at module eval, so importing this module is byte-identical-at-rest. The
 * server never connects: this is a client module and the socket is only created
 * inside a client subscription.
 *
 * ── TICKER KEYING MIRRORS `/api/prices` ──────────────────────────────────────
 * `src/app/api/prices/route.ts` matches an HL coin symbol to a Hub TICKER key
 * case-insensitively (`hlByUpper[sym.toUpperCase()]` ingest, `t.toUpperCase()`
 * lookup) and returns the price under the caller's exact-casing key. This store
 * mirrors that: marks are keyed by `normalizeCoin(coin) = coin.toUpperCase()` and
 * `useLiveMark(ticker)` looks up by `ticker.toUpperCase()`. The uppercase is a
 * MATCH key only — no coin is ever stored in a forced casing that a consumer
 * sees — so `kPEPE` (HL's 1000x PEPE perp) resolves with the exact `kPEPE` TICKER
 * key a consumer would pass to `/api/prices`. Never `.toUpperCase()` a coin as a
 * displayed/returned value; only as this match key.
 *
 * ── RESILIENCE: MINIMAL ONLY ─────────────────────────────────────────────────
 * On close/error the socket is cleared and `connected` set false, so a later
 * subscribe re-opens. Full reconnect/backoff is OUT OF SCOPE (B7) — not built
 * here; this only avoids crashing and leaves a clean slate for a fresh subscribe.
 */

import { useCallback, useRef, useSyncExternalStore } from "react";

const HL_WS_URL = "wss://api.hyperliquid.xyz/ws";
const ALL_MIDS_SUBSCRIBE = {
  method: "subscribe",
  subscription: { type: "allMids" },
} as const;

export interface LiveMark {
  /** Latest mid price for the coin. */
  price: number;
  /** `Date.now()` when this mark was last written from a WS frame. */
  ts: number;
}

export interface LiveMarkResult {
  price: number | null;
  ts: number | null;
  connected: boolean;
}

type Listener = () => void;

/** Stable inert snapshot — the server snapshot and the flag-OFF result. */
const INERT_RESULT: LiveMarkResult = Object.freeze({
  price: null,
  ts: null,
  connected: false,
});

// ── module-level singleton state ─────────────────────────────────────────────
const marks = new Map<string, LiveMark>(); // key = normalizeCoin(coin)
const listeners = new Set<Listener>();
let refCount = 0;
let socket: WebSocket | null = null;
let connected = false;

/**
 * Case-fold a coin/ticker to its match key — mirrors `/api/prices`' `hlByUpper`
 * (`sym.toUpperCase()`) ingest + `t.toUpperCase()` lookup. Uppercase is the MATCH
 * key only; nothing downstream renders this value, so `kPEPE` stays safe.
 */
function normalizeCoin(coin: string): string {
  return coin.toUpperCase();
}

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A misbehaving listener must never break the notify loop or the socket.
    }
  }
}

/**
 * Pull the `mids` map out of a raw WS frame, or null if it isn't an `allMids`
 * data frame. No `any`: parse to `unknown` and narrow defensively.
 */
function extractMids(raw: string): Record<string, string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // malformed frame
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const frame = parsed as { channel?: unknown; data?: unknown };
  if (frame.channel !== "allMids") return null; // subscriptionResponse / other channels
  if (typeof frame.data !== "object" || frame.data === null) return null;
  const mids = (frame.data as { mids?: unknown }).mids;
  if (typeof mids !== "object" || mids === null) return null;
  return mids as Record<string, string>;
}

function ingestMessage(raw: string): void {
  const mids = extractMids(raw);
  if (!mids) return;

  const ts = Date.now();
  let changed = false;
  for (const [coin, priceStr] of Object.entries(mids)) {
    const price = parseFloat(priceStr);
    if (!Number.isFinite(price)) continue;
    marks.set(normalizeCoin(coin), { price, ts });
    changed = true;
  }
  if (changed) notifyListeners();
}

function openSocket(): void {
  if (socket) return; // idempotent — already open or connecting
  let ws: WebSocket;
  try {
    ws = new WebSocket(HL_WS_URL);
  } catch {
    socket = null;
    connected = false;
    return; // construction failed (e.g. no WebSocket) — stay dormant, don't crash
  }
  socket = ws;

  ws.onopen = () => {
    connected = true;
    try {
      ws.send(JSON.stringify(ALL_MIDS_SUBSCRIBE));
    } catch {
      // A send failure surfaces as a close/error below; nothing else to do here.
    }
    notifyListeners();
  };
  ws.onmessage = (event: MessageEvent) => {
    if (typeof event.data === "string") ingestMessage(event.data);
  };
  ws.onerror = () => {
    connected = false;
    notifyListeners();
  };
  ws.onclose = () => {
    connected = false;
    if (socket === ws) socket = null; // clear so a later subscribe re-opens (B7 owns reconnect)
    notifyListeners();
  };
}

function closeSocket(): void {
  connected = false;
  const ws = socket;
  socket = null;
  if (ws) {
    try {
      ws.close();
    } catch {
      // Already closing/closed — ignore.
    }
  }
}

/**
 * Register a listener and ensure the feed is live. Opens the WS on the first
 * subscriber (or re-opens it if a prior socket was cleared by a drop). Returns an
 * idempotent unsubscribe that closes the WS when the last subscriber leaves.
 */
function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  refCount += 1;
  if (!socket) openSocket(); // first subscriber, or a re-subscribe after a drop

  let active = true;
  return () => {
    if (!active) return; // idempotent
    active = false;
    listeners.delete(listener);
    refCount -= 1;
    if (refCount <= 0) {
      refCount = 0;
      closeSocket();
    }
  };
}

/**
 * Subscribe to the live mark for `ticker`.
 *
 * Pass `enabled` to gate the subscription so Round-2 consumers can call this hook
 * UNCONDITIONALLY (React hook rules) while wiring it to the live-terminal flag:
 * `useLiveMark(ticker, liveTerminalFlag)`. When `enabled` is false the hook
 * subscribes to nothing and opens no socket — so flag-OFF is byte-identical to
 * the Hub today. Returns the latest mark (`null` until the first frame for that
 * coin lands) plus the live connection state.
 */
export function useLiveMark(ticker: string, enabled = false): LiveMarkResult {
  const key = normalizeCoin(ticker);
  const cacheRef = useRef<LiveMarkResult>(INERT_RESULT);

  const subscribeFn = useCallback(
    (onStoreChange: () => void): (() => void) =>
      enabled ? subscribe(onStoreChange) : () => {},
    [enabled],
  );

  const getSnapshot = useCallback((): LiveMarkResult => {
    if (!enabled) {
      cacheRef.current = INERT_RESULT;
      return INERT_RESULT;
    }
    const mark = marks.get(key);
    const price = mark ? mark.price : null;
    const ts = mark ? mark.ts : null;
    const prev = cacheRef.current;
    // Return a stable reference when nothing changed so useSyncExternalStore
    // neither warns ("getSnapshot should be cached") nor re-renders spuriously.
    if (prev.price === price && prev.ts === ts && prev.connected === connected) {
      return prev;
    }
    const next: LiveMarkResult = { price, ts, connected };
    cacheRef.current = next;
    return next;
  }, [enabled, key]);

  const getServerSnapshot = useCallback((): LiveMarkResult => INERT_RESULT, []);

  return useSyncExternalStore(subscribeFn, getSnapshot, getServerSnapshot);
}
