"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  MetricTile,
  Pill,
  Skeleton,
  EmptyState,
  MoneyText,
} from "@/components/ui";
import { Target } from "lucide-react";

interface ConfidenceTier {
  confidence_range: string;
  label: string;
  trade_count: number;
  wins: number;
  losses: number;
  win_rate: number; // 0-100
  avg_pnl_pct: number;
  total_pnl_pct: number;
  profit_factor: number | null;
  recommendation: string;
}

interface TiersResponse {
  available?: boolean;
  reason?: string;
  total_signals?: number;
  signals_taken?: number;
  take_rate?: number;
  tiers?: ConfidenceTier[];
}

export function QualitySection() {
  const [data, setData] = React.useState<TiersResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const fetchTiers = async () => {
      try {
        const res = await fetch("/api/analytics/confidence-tiers", {
          cache: "no-store",
        });
        if (!cancelled && res.ok) {
          const j = (await res.json()) as TiersResponse;
          setData(j);
        }
      } catch {
        // keep last good
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchTiers();
    const id = setInterval(fetchTiers, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const tiers = data?.tiers ?? [];
  const populated = tiers.filter((t) => t.trade_count > 0);

  return (
    <Card padding="md">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Target size={14} />
              SIGNAL QUALITY · BY CONFIDENCE
            </span>
          </CardTitle>
          {data?.take_rate !== undefined && (
            <Pill tone="neutral" size="sm">
              take rate {data.take_rate.toFixed(1)}%
            </Pill>
          )}
        </CardHeader>

        {loading && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        )}

        {!loading && (data?.available === false || populated.length === 0) && (
          <EmptyState
            title="No tier data yet"
            body={
              data?.reason ??
              "Need closed trades with confidence captured to compute per-tier WR."
            }
          />
        )}

        {!loading && populated.length > 0 && (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-2">
            {tiers.map((t) => {
              const empty = t.trade_count === 0;
              const tone = empty
                ? "neutral"
                : t.win_rate >= 55
                ? "green"
                : t.win_rate >= 45
                ? "cyan"
                : t.win_rate >= 35
                ? "amber"
                : "red";
              const metricTone = empty
                ? "neutral"
                : t.win_rate >= 55
                ? "positive"
                : t.win_rate >= 45
                ? "cyan"
                : t.win_rate >= 35
                ? "warn"
                : "negative";
              return (
                <li
                  key={t.confidence_range}
                  className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-elevated p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-h3 font-bold">{t.label}</span>
                    <Pill tone={tone as "green" | "cyan" | "amber" | "red" | "neutral"} size="sm">
                      {t.trade_count} trades
                    </Pill>
                  </div>
                  {empty ? (
                    <div className="text-micro text-fg-muted">
                      No trades at this level yet.
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <MetricTile
                          label="Win Rate"
                          value={`${t.win_rate.toFixed(1)}%`}
                          tone={metricTone}
                          size="sm"
                          sub={`${t.wins}W / ${t.losses}L`}
                        />
                        <MetricTile
                          label="Avg P&L"
                          value={
                            <MoneyText
                              value={t.avg_pnl_pct}
                              unit="%"
                              size="sm"
                              decimals={2}
                              showSign
                            />
                          }
                          size="sm"
                          sub={
                            t.profit_factor !== null
                              ? `PF ${t.profit_factor.toFixed(2)}`
                              : "PF n/a"
                          }
                        />
                      </div>
                      <div className="text-micro text-fg-muted">
                        {t.recommendation}
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
    </Card>
  );
}
