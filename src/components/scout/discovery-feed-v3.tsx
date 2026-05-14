"use client";

import { useEffect, useState } from "react";

import type { DiscoveryV2Response } from "@/lib/scout-v3-types";

import { DiscoveryCardV3 } from "./discovery-card-v3";

/**
 * DiscoveryFeedV3 — fetches /api/scout/discoveries/v2 (G3 endpoint) and renders cards.
 *
 * G4a: no engine/days filter UI yet (uses defaults: days=7, limit=10).
 * G4b adds segmented controls + the drawer for the "More" button stub.
 */
export function DiscoveryFeedV3() {
  const [data, setData] = useState<DiscoveryV2Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const r = await fetch("/api/scout/discoveries/v2?days=7&limit=10", {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }
        const body = (await r.json()) as DiscoveryV2Response;
        if (!cancelled) {
          setData(body);
        }
      } catch (e: unknown) {
        const err = e as { name?: string; message?: string };
        if (err?.name === "AbortError") return;
        if (!cancelled) setError(String(err?.message ?? e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, []);

  // Header rendered unconditionally so it's present in SSR HTML — better UX
  // (immediate visual anchor while data fetches) AND deterministic smoke
  // verification (curl-fetched HTML carries the v3 marker regardless of
  // hydration state).
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="font-mono text-sm uppercase tracking-[0.2em] text-fuchsia-400 drop-shadow-[0_0_8px_rgba(232,121,249,0.5)]">
          🧭 SCOUT DISCOVERIES · v3
        </h2>
        <span className="font-mono text-[10px] text-zinc-500">
          {loading
            ? "loading…"
            : data
              ? `${data.meta.count} picks · last ${data.meta.window_days}d`
              : ""}
        </span>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-lg border border-zinc-800 bg-zinc-950/40 h-[420px] animate-pulse"
            />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-4 text-red-300 font-mono text-sm">
          Failed to load discoveries: {error}
        </div>
      ) : !data || data.discoveries.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-8 text-center text-zinc-500 font-mono text-sm">
          No discoveries in window.
        </div>
      ) : (
        data.discoveries.map((item) => (
          <DiscoveryCardV3 key={`${item.ticker}-${item.posted_at}`} item={item} />
        ))
      )}
    </div>
  );
}
