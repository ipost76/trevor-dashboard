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
 * ── RESILIENCE: RECONNECT + STATUS (B8) ──────────────────────────────────────
 * On an unexpected close/error WHILE SUBSCRIBERS REMAIN, a reconnect is scheduled
 * with capped exponential backoff + equal jitter (1s → 2s → … → 30s cap) — never
 * a tight loop (one pending timer at a time), reset on a healthy open. When the
 * last subscriber leaves the timer is cancelled and the socket closed. Past
 * `RECONNECT_MAX_ATTEMPTS` consecutive failures the delay holds at the cap and we
 * keep slow-retrying while reporting `stale` (degraded), so the feed self-heals
 * when the network returns. `useLiveStatus()` exposes the coarse connection state
 * ("live"/"reconnecting"/"stale"/"idle") as a PASSIVE observer that never opens a
 * socket — so the status pill can read the state without itself causing a
 * connection (DO-NO-HARM: no `useLiveMark` subscriber → no socket, ever).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

const HL_WS_URL = "wss://api.hyperliquid.xyz/ws";
const ALL_MIDS_SUBSCRIBE = {
  method: "subscribe",
  subscription: { type: "allMids" },
} as const;

// ── B8 reconnect + status tuning ─────────────────────────────────────────────
const RECONNECT_BASE_MS = 1_000; // first retry delay
const RECONNECT_CAP_MS = 30_000; // max backoff between retries
const RECONNECT_MAX_EXP = 5; // 2**5 * 1s = 32s ≥ cap → ladder tops out at the cap
const RECONNECT_MAX_ATTEMPTS = 8; // past this: hold at cap + report `stale`, keep retrying
const STALE_AFTER_MS = 10_000; // newest mark older than this (while open) → stale
const STATUS_TICK_MS = 2_000; // pill re-evaluates age-based staleness this often

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

/** Coarse connection status for the live-feed pill (B8). */
export type LiveStatus = "idle" | "live" | "reconnecting" | "stale";

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

// ── B8 reconnect + status state ──────────────────────────────────────────────
const statusListeners = new Set<Listener>(); // passive observers — never open a socket
let lastMarkTs: number | null = null; // newest mark ts (Date.now() at ingest)
let reconnectAttempts = 0; // consecutive failed (re)connects; reset on a healthy open
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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

/** Notify passive status observers (the pill). Never opens/touches the socket. */
function notifyStatus(): void {
  for (const listener of statusListeners) {
    try {
      listener();
    } catch {
      // A misbehaving status listener must never break the loop.
    }
  }
}

/**
 * Register a PASSIVE status observer. Unlike `subscribe()`, this does NOT touch
 * `refCount` and NEVER opens a socket — so the status pill can read the live
 * state without itself causing a connection (DO-NO-HARM: no `useLiveMark`
 * subscriber → no socket). Returns an idempotent unsubscribe.
 */
function subscribeStatus(listener: Listener): () => void {
  statusListeners.add(listener);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    statusListeners.delete(listener);
  };
}

/** Derive the coarse connection status from the live singleton state. */
function computeStatus(): LiveStatus {
  if (refCount <= 0) return "idle"; // no price subscribers → no socket
  if (connected) {
    if (lastMarkTs === null) return "reconnecting"; // open, no frame received yet
    return Date.now() - lastMarkTs > STALE_AFTER_MS ? "stale" : "live";
  }
  // Disconnected with subscribers → backing off. Past MAX_ATTEMPTS we keep
  // slow-retrying at the cap but report `stale` (degraded) so it self-heals.
  return reconnectAttempts >= RECONNECT_MAX_ATTEMPTS ? "stale" : "reconnecting";
}

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

/**
 * Schedule a reconnect with capped exponential backoff + equal jitter, but ONLY
 * while subscribers remain. Never a tight loop (one pending timer at a time),
 * never opens a second socket. Past RECONNECT_MAX_ATTEMPTS the delay holds at the
 * cap and we keep slow-retrying — the feed self-heals when the network returns;
 * we never give up while a consumer is mounted.
 */
function scheduleReconnect(): void {
  if (refCount <= 0) return; // no subscribers — nothing to reconnect for
  if (socket) return; // already (re)connecting/connected
  if (reconnectTimer) return; // a retry is already pending

  const exp = Math.min(reconnectAttempts, RECONNECT_MAX_EXP);
  const capped = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** exp);
  // Equal jitter: half fixed + half random — avoids a synchronized retry storm
  // without ever collapsing to a near-zero delay (tight-loop guard).
  const delay = capped / 2 + Math.random() * (capped / 2);
  reconnectAttempts += 1;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (refCount > 0 && !socket) openSocket();
  }, delay);
  notifyStatus();
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
  if (changed) {
    lastMarkTs = ts; // newest-mark age feeds the stale/live status
    notifyListeners();
  }
}

function openSocket(): void {
  if (socket) return; // idempotent — already open or connecting
  clearReconnectTimer(); // we're (re)connecting now — cancel any pending retry
  let ws: WebSocket;
  try {
    ws = new WebSocket(HL_WS_URL);
  } catch {
    socket = null;
    connected = false;
    scheduleReconnect(); // construction failed — retry with backoff if subscribers remain
    return; // ...stay dormant, don't crash
  }
  socket = ws;

  ws.onopen = () => {
    connected = true;
    reconnectAttempts = 0; // healthy connection — reset the backoff ladder
    try {
      ws.send(JSON.stringify(ALL_MIDS_SUBSCRIBE));
    } catch {
      // A send failure surfaces as a close/error below; nothing else to do here.
    }
    notifyListeners();
    notifyStatus();
  };
  ws.onmessage = (event: MessageEvent) => {
    if (typeof event.data === "string") ingestMessage(event.data);
  };
  ws.onerror = () => {
    connected = false;
    notifyListeners();
    notifyStatus();
    // onclose always follows onerror and owns the reconnect scheduling.
  };
  ws.onclose = () => {
    connected = false;
    if (socket === ws) socket = null; // clear so the reconnect/subscribe re-opens
    scheduleReconnect(); // capped exponential backoff while subscribers remain
    notifyListeners();
    notifyStatus();
  };
}

function closeSocket(): void {
  connected = false;
  clearReconnectTimer(); // last subscriber left — stop retrying
  reconnectAttempts = 0;
  const ws = socket;
  socket = null;
  if (ws) {
    try {
      ws.close();
    } catch {
      // Already closing/closed — ignore.
    }
  }
  notifyStatus();
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
  notifyStatus(); // refCount changed — idle → connecting/live

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

/**
 * Subscribe to the coarse live-feed status for the status pill.
 *
 * PASSIVE: this hook never opens a socket — it only observes the singleton's
 * connection state via `subscribeStatus` plus a light interval that re-evaluates
 * age-based staleness while mounted. Returns "idle" on the server and the first
 * client render (SSR-safe — no hydration mismatch), then resolves after mount.
 * When `enabled` is false it stays "idle" and runs no interval, so flag-OFF is
 * fully inert (no observer, no timer, and — critically — no socket).
 */
export function useLiveStatus(enabled = false): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("idle");

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }
    const update = (): void => setStatus(computeStatus());
    update();
    const unsubscribe = subscribeStatus(update); // transition events (no socket)
    const id = setInterval(update, STATUS_TICK_MS); // catch live↔stale by mark age
    return () => {
      unsubscribe();
      clearInterval(id);
    };
  }, [enabled]);

  return status;
}
