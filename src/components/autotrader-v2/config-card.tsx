"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, Pill, MetricTile, Skeleton } from "@/components/ui";
import { Settings } from "lucide-react";

interface AutoConfig {
  capital_cap_usd: number;       // RM-07 P00 — vestigial; cap removed
  margin_mode: string;           // RM-07 P00 — "isolated" mandatory
  live_per_trade_usd: number;
  confidence_floor: number;
  max_leverage: number;
  per_ticker_thresholds_enabled: boolean;
  data_available: boolean;
}

export function ConfigCard() {
  const [data, setData] = React.useState<AutoConfig | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const fetchConfig = async () => {
      try {
        const res = await fetch("/api/auto/config", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const j = (await res.json()) as AutoConfig;
        if (!cancelled) setData(j);
      } catch {
        /* keep last good state */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchConfig();
    const id = setInterval(fetchConfig, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // RM-07 P00 (2026-05-28): capitalCap is vestigial; marginMode replaces it on display
  const marginMode = (data?.margin_mode ?? "isolated").toUpperCase();
  const perTrade = data?.live_per_trade_usd ?? 10;
  const confFloor = data?.confidence_floor ?? 35;
  const maxLev = data?.max_leverage ?? 5;
  const perTickerOn = data?.per_ticker_thresholds_enabled === true;

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
          <Pill
            tone="cyan"
            size="sm"
            className="bg-accent-cyan-soft/10 text-accent-cyan-soft-strong border-accent-cyan-soft/30"
          >
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
              label="Margin Mode"
              value={marginMode}
              sub="risk isolation"
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

          <div className="mt-3 font-sans text-caption text-fg-muted">
            Per-ticker thresholds:{" "}
            {perTickerOn ? (
              <span className="text-accent-mint">enabled</span>
            ) : (
              <span className="text-accent-gold">disabled (using floor)</span>
            )}{" "}
            · edit via{" "}
            <code className="font-mono text-accent-cyan-soft">!filter</code> in Discord
          </div>
        </>
      )}
    </Card>
  );
}
