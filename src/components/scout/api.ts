// SCOUT API client. All requests hit /api/scout/* (nginx → 127.0.0.1:3334
// inside the SCOUT process). Same-origin, so no CORS headache from the
// browser; cookies are not used because the SCOUT API has no auth (the
// Hub session cookie gates this whole page upstream).
//
// On the VM, /api/scout/* is *also* reachable directly at
// http://127.0.0.1:3334/api/scout/* — but that path is for server-side
// rendering only. Every component here is `'use client'` so we always
// use relative URLs from the browser.

import type {
  HealthResponse,
  HistoryResponse,
  ScoutConfig,
  Signal,
  SignalsResponse,
  WatchlistResponse,
  Engine,
} from "./types";

const BASE = "/api/scout";

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SCOUT ${path} → HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  return res.json() as Promise<T>;
}

export function fetchHealth(signal?: AbortSignal) {
  return getJson<HealthResponse>("/health", signal);
}

export function fetchSignals(
  engine: Engine,
  opts: { limit?: number; date?: string; signal?: AbortSignal } = {},
) {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.date) params.set("date", opts.date);
  const qs = params.toString();
  return getJson<SignalsResponse>(`/signals/${engine}${qs ? `?${qs}` : ""}`, opts.signal);
}

export function fetchHistory(
  engine: Engine,
  opts: { days?: number; ticker?: string; signal?: AbortSignal } = {},
) {
  const params = new URLSearchParams({ engine });
  if (opts.days !== undefined) params.set("days", String(opts.days));
  if (opts.ticker) params.set("ticker", opts.ticker);
  return getJson<HistoryResponse>(`/signals/history?${params.toString()}`, opts.signal);
}

export function fetchWatchlist(signal?: AbortSignal) {
  return getJson<WatchlistResponse>("/watchlist", signal);
}

export async function addToWatchlist(
  ticker: string,
  opts: { engine?: string; notes?: string } = {},
): Promise<{ status: string; ticker: string }> {
  const params = new URLSearchParams({ ticker });
  if (opts.engine) params.set("engine", opts.engine);
  if (opts.notes) params.set("notes", opts.notes);
  const res = await fetch(`${BASE}/watchlist/add?${params.toString()}`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SCOUT add → HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  return res.json();
}

export async function removeFromWatchlist(
  ticker: string,
): Promise<{ status: string; ticker: string }> {
  const res = await fetch(`${BASE}/watchlist/${encodeURIComponent(ticker)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SCOUT remove → HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  return res.json();
}

export function fetchConfig(signal?: AbortSignal) {
  return getJson<ScoutConfig>("/config", signal);
}

export async function updateConfig(
  updates: Record<string, string | number>,
): Promise<{ status: string; updated_keys: string[]; note: string }> {
  const res = await fetch(`${BASE}/config`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = `${detail}: ${body.detail}`;
    } catch {
      /* ignore */
    }
    throw new Error(`SCOUT config update → ${detail}`);
  }
  return res.json();
}

// Helpers —————————————————————————————————————————————

export function isNewSignal(s: Signal | undefined | null): boolean {
  return !!s?.is_new;
}
