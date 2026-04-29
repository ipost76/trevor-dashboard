"use client";
import * as React from "react";
import {
  Card,
  SegmentedToggle,
  MoneyText,
  Pill,
  Skeleton,
  EmptyState,
} from "@/components/ui";
import { Sparkline } from "./sparkline";
import { Bot, Activity, Skull } from "lucide-react";

type System = "auto" | "degen" | "scalp";
type Range = "today" | "7d" | "30d" | "lifetime";

interface PnLResponse {
  system: System;
  range: Range;
  total_pnl_pct: number;
  total_pnl_usd: number;
  wins: number;
  losses: number;
  win_rate: number;
  streak: number;
  trade_count: number;
  equity_series: ReadonlyArray<{ ts: string; equity: number; pnl: number }>;
  data_available: boolean;
  message?: string | null;
}

const SYSTEM_OPTIONS = [
  { value: "auto" as const, label: "Auto" },
  { value: "degen" as const, label: "Degen" },
  { value: "scalp" as const, label: "Scalp" },
];
const RANGE_OPTIONS = [
  { value: "today" as const, label: "Today" },
  { value: "7d" as const, label: "7D" },
  { value: "30d" as const, label: "30D" },
  { value: "lifetime" as const, label: "Life" },
];

// C1 (2026-04-29): Static class strings to keep Tailwind static-analyzer happy.
// Dynamic `text-accent-${tone}` would be tree-shaken away.
type AccentTone = "green" | "magenta" | "cyan";
const SYSTEM_ACCENT: Record<
  System,
  {
    hex: string;
    tone: AccentTone;
    pillTone: "green" | "magenta" | "cyan";
    cardGlow: "green" | "magenta" | "cyan";
    iconClass: string;
    icon: typeof Bot;
  }
> = {
  auto: {
    hex: "#00ff88",
    tone: "green",
    pillTone: "green",
    cardGlow: "green",
    iconClass: "text-accent-green",
    icon: Bot,
  },
  degen: {
    hex: "#ff00ff",
    tone: "magenta",
    pillTone: "magenta",
    cardGlow: "magenta",
    iconClass: "text-accent-magenta",
    icon: Skull,
  },
  scalp: {
    hex: "#00f0ff",
    tone: "cyan",
    pillTone: "cyan",
    cardGlow: "cyan",
    iconClass: "text-accent-cyan",
    icon: Activity,
  },
};

export function HeroPnLCard() {
  const [system, setSystem] = React.useState<System>("auto");
  const [range, setRange] = React.useState<Range>("7d");
  const [data, setData] = React.useState<PnLResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/dashboard/pnl?system=${system}&range=${range}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as PnLResponse;
      setData(json);
    } catch (err) {
      setError(String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [system, range]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  React.useEffect(() => {
    const id = setInterval(fetchData, 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const accent = SYSTEM_ACCENT[system];
  const Icon = accent.icon;

  return (
    <Card glow={accent.cardGlow} padding="lg" className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon size={18} className={accent.iconClass} />
          <span className="text-micro text-fg-muted">Total P&amp;L</span>
        </div>
        <Pill tone={accent.pillTone} size="sm">
          {system.toUpperCase()}
        </Pill>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <SegmentedToggle
          ariaLabel="System"
          full
          options={SYSTEM_OPTIONS}
          value={system}
          onChange={setSystem}
        />
        <SegmentedToggle
          ariaLabel="Range"
          full
          options={RANGE_OPTIONS}
          value={range}
          onChange={setRange}
        />
      </div>

      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-12 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {!loading && error && (
        <EmptyState title="Failed to load" body={error} />
      )}

      {!loading && !error && data && !data.data_available && (
        <div className="py-6 text-center">
          <div className="text-h2 text-fg-muted">
            {system === "degen" ? "💀 Coming soon" : "—"}
          </div>
          <div className="mt-1 text-caption text-fg-muted">
            {data.message ?? "No data"}
          </div>
        </div>
      )}

      {!loading && !error && data && data.data_available && (
        <>
          <div className="flex flex-col items-start gap-1">
            <MoneyText
              value={data.total_pnl_pct}
              unit="%"
              size="hero"
              showSign
            />
            {system === "auto" && (
              <span className="text-caption text-fg-muted">
                <MoneyText
                  value={data.total_pnl_usd}
                  unit="$"
                  size="sm"
                  showSign
                />{" "}
                realized
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-muted">
            <span>
              <span className="text-accent-green">{data.wins}W</span>{" "}
              ·{" "}
              <span className="text-accent-red">{data.losses}L</span>
            </span>
            <span className="text-fg-faint">·</span>
            <span>
              WR{" "}
              <span className="text-fg-primary">
                {data.win_rate.toFixed(1)}%
              </span>
            </span>
            <span className="text-fg-faint">·</span>
            <span>
              {data.streak >= 0 ? "🔥" : "❄️"} {Math.abs(data.streak)}
            </span>
            <span className="text-fg-faint">·</span>
            <span>{data.trade_count} trades</span>
          </div>

          <Sparkline data={data.equity_series} color={accent.hex} height={72} />
        </>
      )}
    </Card>
  );
}
