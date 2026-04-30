"use client";
import * as React from "react";
import { Card, MetricTile, Skeleton } from "@/components/ui";
import { Activity, Target, ArrowUpDown, Zap } from "lucide-react";

type TileTone = "neutral" | "warn";

interface QuickStats {
  today_signals: number;
  avg_confidence: number;
  long_pct: number;
  short_pct: number;
  lifetime_xp: number;
  data_available: boolean;
}

export function QuickStatsStrip() {
  const [data, setData] = React.useState<QuickStats | null>(null);
  const [loading, setLoading] = React.useState(true);

  const fetchData = React.useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/quick-stats", { cache: "no-store" });
      if (res.ok) setData((await res.json()) as QuickStats);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);
  React.useEffect(() => {
    const id = setInterval(fetchData, 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const bias = data
    ? data.long_pct >= data.short_pct
      ? `${data.long_pct.toFixed(0)}L / ${data.short_pct.toFixed(0)}S`
      : `${data.short_pct.toFixed(0)}S / ${data.long_pct.toFixed(0)}L`
    : "—";
  const biasTone: TileTone = data && Math.abs(data.long_pct - data.short_pct) > 30 ? "warn" : "neutral";

  const tiles: Array<{
    key: string;
    icon: React.ReactNode;
    label: string;
    value: string;
    sub: string;
    tone?: TileTone;
  }> = [
    {
      key: "signals",
      icon: <Activity size={14} className="text-accent-cyan" />,
      label: "Today",
      value: data ? data.today_signals.toString() : "—",
      sub: "signals · 24h",
    },
    {
      key: "confidence",
      icon: <Target size={14} className="text-accent-violet" />,
      label: "Avg Confidence",
      value: data ? data.avg_confidence.toFixed(1) : "—",
      sub: "past 24h · 0-100",
    },
    {
      key: "bias",
      icon: <ArrowUpDown size={14} className="text-accent-amber" />,
      label: "Bias",
      value: bias,
      sub: "L/S split · 24h",
      tone: biasTone,
    },
    {
      key: "xp",
      icon: <Zap size={14} className="text-accent-green" />,
      label: "Lifetime XP",
      value: data ? data.lifetime_xp.toLocaleString() : "—",
      sub: "all time",
    },
  ];

  if (loading && !data) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <Skeleton key={t.key} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div
      className={[
        "flex gap-3 overflow-x-auto -mx-4 px-4 pb-1 snap-x snap-mandatory [scrollbar-width:none]",
        "[&::-webkit-scrollbar]:hidden",
        "md:mx-0 md:px-0 md:grid md:grid-cols-4 md:overflow-visible md:snap-none",
      ].join(" ")}
    >
      {tiles.map((t) => (
        <Card
          key={t.key}
          padding="sm"
          className="min-w-[44%] snap-start flex flex-col gap-1.5 md:min-w-0"
        >
          <div className="flex items-center gap-1.5 text-micro text-fg-muted">
            {t.icon}
            <span>{t.label}</span>
          </div>
          <MetricTile
            label=""
            value={<span className="text-h2 tabular-nums">{t.value}</span>}
            tone={t.tone === "warn" ? "warn" : "neutral"}
            sub={<span className="text-micro">{t.sub}</span>}
          />
        </Card>
      ))}
    </div>
  );
}
