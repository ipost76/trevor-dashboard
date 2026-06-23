"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, Pill, EmptyState, Skeleton } from "@/components/ui";
import { CHART_COLORS } from "@/components/charts/theme";
import { DollarSign, TrendingUp, TrendingDown } from "lucide-react";

// B4 — GCP Cost tracker card on the Health home (sub-tab "cost", /health?tab=cost).
//
// Reads /api/cost (the cost_snapshots CACHE in data/hub.db, never BigQuery on page
// load). Shows month-to-date total, a linear month-end forecast, per-service
// breakdown, and a 30-day daily history bar chart. When the export is still
// backfilling (cache empty) it renders a clean "syncing" state, never a broken
// card. Cost is NOT rendered green (green = profit elsewhere) — a projected rise
// vs last month reads gold/red, a fall reads mint.

const ENDPOINT = "/api/cost";
const POLL_MS = 120_000; // cost data refreshes once daily; a light 2-min poll is plenty

interface Breakdown {
  service: string;
  net_usd: number;
}
interface HistPoint {
  date: string;
  net_usd: number;
}
interface CostData {
  status: "ok" | "no_data_yet";
  month_label: string | null;
  mtd_total_usd: number;
  mtd_gross_usd: number;
  days_elapsed: number;
  days_in_month: number;
  projected_month_end_usd: number;
  last_month_total_usd: number | null;
  mom_pct: number | null;
  breakdown: Breakdown[];
  history: HistPoint[];
  fetched_at: string | null;
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtAge(iso: string | null): string {
  if (!iso) return "—";
  const norm = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso.replace(" ", "T") + "Z";
  const t = Date.parse(norm);
  if (Number.isNaN(t)) return iso;
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function HistoryChart({ history }: { history: HistPoint[] }) {
  const max = Math.max(...history.map((h) => h.net_usd), 0.0001);
  const W = 320;
  const H = 60;
  const gap = history.length > 60 ? 1 : 2;
  const n = history.length;
  const bw = Math.max(0.5, (W - gap * Math.max(0, n - 1)) / n);
  const first = history[0]?.date;
  const last = history[history.length - 1]?.date;
  const shortDay = (d?: string) => (d ? d.slice(5).replace("-", "/") : "");
  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-16 w-full"
        role="img"
        aria-label="Daily GCP cost, last 30 days"
      >
        {history.map((h, i) => {
          const bh = Math.max(1, (h.net_usd / max) * (H - 2));
          const x = i * (bw + gap);
          return (
            <rect
              key={h.date}
              x={x}
              y={H - bh}
              width={bw}
              height={bh}
              fill={CHART_COLORS.cyan}
              opacity={0.75}
            >
              <title>{`${h.date}: ${fmtUsd(h.net_usd)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="flex justify-between text-micro text-fg-faint">
        <span className="font-mono">{shortDay(first)}</span>
        <span>daily net · 30d</span>
        <span className="font-mono">{shortDay(last)}</span>
      </div>
    </div>
  );
}

export function CostTrackerCard() {
  const [data, setData] = React.useState<CostData | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const res = await fetch(ENDPOINT, { cache: "no-store", signal: ctrl.signal });
        if (res.ok) setData((await res.json()) as CostData);
      } catch {
        /* keep last-good on a transient error */
      } finally {
        setLoaded(true);
      }
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      ctrl.abort();
      clearInterval(timer);
    };
  }, []);

  if (!loaded) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <DollarSign size={13} className="text-accent-gold" /> GCP COST
          </CardTitle>
        </CardHeader>
        <Skeleton className="h-32 w-full" />
      </Card>
    );
  }

  const syncing = !data || data.status !== "ok";

  return (
    <Card className="border-l-4 border-l-accent-gold">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <DollarSign size={13} className="text-accent-gold" /> GCP COST
        </CardTitle>
        {!syncing && data?.fetched_at && (
          <span className="text-micro text-fg-muted">updated {fmtAge(data.fetched_at)}</span>
        )}
      </CardHeader>

      {syncing ? (
        <EmptyState
          icon={<DollarSign size={28} />}
          title="Billing data is syncing"
          body="GCP's billing export backfills over a few hours. The cost card lights up automatically once data lands — check back soon."
        />
      ) : (
        <div className="space-y-5">
          {/* Hero — month-to-date + projected month-end */}
          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-display font-bold tabular-nums text-fg-primary">
                {fmtUsd(data!.mtd_total_usd)}
              </span>
              <span className="text-caption text-fg-muted">
                month to date · {data!.month_label}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-caption tabular-nums text-fg-muted">
                projected {fmtUsd(data!.projected_month_end_usd)}
              </span>
              <span className="text-micro text-fg-faint">
                ({data!.days_elapsed}/{data!.days_in_month}d)
              </span>
              {data!.mom_pct !== null &&
                (data!.mom_pct >= 0 ? (
                  <Pill intent="warn" size="sm">
                    <TrendingUp size={11} className="-mt-px inline" /> +{data!.mom_pct}% vs last mo
                  </Pill>
                ) : (
                  <Pill intent="live" size="sm">
                    <TrendingDown size={11} className="-mt-px inline" /> {data!.mom_pct}% vs last mo
                  </Pill>
                ))}
              {data!.last_month_total_usd !== null && (
                <span className="text-micro text-fg-faint">
                  last mo {fmtUsd(data!.last_month_total_usd)}
                </span>
              )}
            </div>
          </div>

          {/* Per-service breakdown */}
          {data!.breakdown.length > 0 && (
            <div className="space-y-2">
              <div className="text-micro uppercase tracking-wider text-fg-muted">
                By service · this month
              </div>
              <ul className="space-y-1.5">
                {data!.breakdown.map((b) => {
                  const pct =
                    data!.mtd_total_usd > 0
                      ? Math.max(0, (b.net_usd / data!.mtd_total_usd) * 100)
                      : 0;
                  return (
                    <li key={b.service} className="space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-caption text-fg-primary">{b.service}</span>
                        <span className="shrink-0 font-mono text-caption tabular-nums text-fg-muted">
                          {fmtUsd(b.net_usd)}
                        </span>
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-bg-elevated">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: CHART_COLORS.cyan }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* 30-day daily history */}
          {data!.history.length > 0 && (
            <div className="space-y-2">
              <div className="text-micro uppercase tracking-wider text-fg-muted">History</div>
              <HistoryChart history={data!.history} />
            </div>
          )}

          <p className="text-micro text-fg-faint">
            Net cost (incl. credits). Forecast is a linear projection of month-to-date spend.
          </p>
        </div>
      )}
    </Card>
  );
}
