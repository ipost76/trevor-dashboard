"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, Pill, MetricTile, Skeleton } from "@/components/ui";
import { Settings } from "lucide-react";

interface RootSnapshot {
  config?: Record<string, string>;
}

interface PerTickerThresholdsResponse {
  enabled: boolean;
}

function num(v: string | undefined, fallback: number): number {
  if (v == null) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export function ConfigCard() {
  const [data, setData] = React.useState<RootSnapshot | null>(null);
  const [perTickerOn, setPerTickerOn] = React.useState<boolean>(true);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    const fetchConfig = async () => {
      try {
        const res = await fetch("/api/auto-trader", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const j = (await res.json()) as RootSnapshot;
        if (!cancelled) setData(j);
      } catch {
        /* keep last good state */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const fetchPerTicker = async () => {
      try {
        const res = await fetch("/api/auto-trader/per-ticker-thresholds", {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const j = (await res.json()) as PerTickerThresholdsResponse;
        if (!cancelled && typeof j.enabled === "boolean") setPerTickerOn(j.enabled);
      } catch {
        /* endpoint may not exist yet — keep default */
      }
    };

    fetchConfig();
    fetchPerTicker();
    const id = setInterval(() => {
      fetchConfig();
      fetchPerTicker();
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const cfg = data?.config ?? {};
  const capitalCap = num(cfg.LIVE_HARD_CAPITAL_CAP_USD, 50);
  const perTrade = num(cfg.LIVE_PER_TRADE_USD, 10);
  const confFloor = num(cfg.AGGRESSIVE_THRESHOLD, 35);
  const maxLev = num(cfg.LIVE_LEVERAGE_DEFAULT, 5);

  return (
    <Card padding="md">
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2 uppercase tracking-wider">
            <Settings size={14} aria-hidden />
            Config
          </span>
        </CardTitle>
        {perTickerOn && (
          <Pill tone="cyan" size="sm">
            PER-TICKER ✓
          </Pill>
        )}
      </CardHeader>

      {loading && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {!loading && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricTile
              label="Capital Cap"
              value={`$${capitalCap.toFixed(0)}`}
              sub="hard floor"
            />
            <MetricTile
              label="Per-Trade"
              value={`$${perTrade.toFixed(0)}`}
              sub="notional"
            />
            <MetricTile
              label="Conf Floor"
              value={String(Math.round(confFloor))}
              sub="threshold"
            />
            <MetricTile
              label="Max Lev"
              value={`${maxLev.toFixed(0)}x`}
              sub="leverage"
            />
          </div>

          <div className="mt-3 text-caption text-fg-muted">
            Per-ticker thresholds:{" "}
            {perTickerOn ? (
              <span className="text-accent-green">enabled</span>
            ) : (
              <span className="text-accent-amber">disabled (using floor)</span>
            )}{" "}
            · edit via{" "}
            <code className="text-accent-cyan">!filter</code> in Discord
          </div>
        </>
      )}
    </Card>
  );
}
