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
} from "@/components/ui";
import { Activity, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { bandRTriggers, fmtCount, fmtPct } from "@/lib/shadow-aggregate";

interface ShadowSummary {
  rows_24h: number;
  rows_7d: number;
  would_fire_24h: number;
  would_fire_7d: number;
  would_fire_trades_24h: number;
  would_fire_trades_7d: number;
  near_miss_24h: number;
  near_miss_7d: number;
  modes: Record<string, number>;
  live_partials_enabled: boolean;
}
interface ByLevel {
  partial_level_r: number;
  partial_pct: number | null;
  would_fire_7d: number;
  near_miss_7d: number;
  blocked_dust_7d: number;
  blocked_fee_7d: number;
}
interface ByTicker {
  ticker: string;
  would_fire: number;
  would_fire_trades: number;
  near_miss: number;
}
interface PartialShadowResponse {
  summary: ShadowSummary;
  by_level: ByLevel[];
  by_ticker: ByTicker[];
  // `recent` (per-trade rows) is still returned by the route but deliberately
  // NOT consumed: HUB-C2 renders aggregates only, never one trade per line.
  error?: string;
}

const POLL_MS = 60_000;
const ENDPOINT = "/api/shadow/partials";

function fmtMode(mode: string): string {
  // Format mode keys for display — same words bot writes to notes_json.
  switch (mode) {
    case "live_disabled":
      return "Live (shadow)";
    case "live_enabled":
      return "Live (executing)";
    case "paper":
      return "Paper";
    case "profile_off":
      return "Profile off";
    case "config_off":
      return "Config off";
    default:
      return mode || "unknown";
  }
}

export function PartialShadowCard() {
  const [data, setData] = React.useState<PartialShadowResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(ENDPOINT, { cache: "no-store" });
        if (res.ok && !cancelled) setData((await res.json()) as PartialShadowResponse);
      } catch {
        // Errors swallowed; keep last-good snapshot on screen.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const id = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Fold the ~1.8k near-unique partial_level_r rows into a handful of coarse
  // R-bands — aggregate sub-rows, shown only on expand. NEVER the raw levels.
  // MUST run unconditionally (before the early return below) — calling it after
  // the `if (loading && !data) return` made the hook count jump 4→5 once data
  // arrived → React #310 "Rendered more hooks than during the previous render".
  const bands = React.useMemo(
    () => bandRTriggers(data?.by_level ?? []),
    [data?.by_level],
  );

  if (loading && !data) {
    return <Skeleton className="h-56 w-full" />;
  }

  const summary = data?.summary;
  const byLevel = data?.by_level ?? [];
  const byTicker = data?.by_ticker ?? [];
  const hasAnyData = summary && summary.rows_7d > 0;

  // Eval-level would-fire rate. This is a COUNTING shadow — partial_trigger_shadow
  // has no realized per-trade P&L (SH-HUB), so there is no honest win-rate or
  // mean $. The would-fire rate is NOT a win-rate.
  const evalRate =
    summary && summary.rows_7d > 0
      ? (summary.would_fire_7d / summary.rows_7d) * 100
      : null;

  return (
    <Card padding="md" className="card-elevated">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity
              size={18}
              className={summary?.live_partials_enabled ? "text-accent-mint" : "text-accent-cyan-soft-strong"}
              aria-hidden
            />
            <CardTitle>Partial Exit Shadow</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Pill intent={summary?.live_partials_enabled ? "running" : "warn"} size="sm">
              {summary?.live_partials_enabled ? "LIVE" : "SHADOW"}
            </Pill>
            <Pill tone="cyan" size="sm">
              {(summary?.rows_7d ?? 0).toLocaleString()} rows 7d
            </Pill>
          </div>
        </div>
      </CardHeader>

      {data?.error && (
        <div className="mb-3 rounded-md border border-accent-red/40 bg-accent-red/10 p-3 font-sans text-caption text-accent-red">
          {data.error}
        </div>
      )}

      {!hasAnyData ? (
        <EmptyState
          title="No shadow rows yet"
          body="Layer 5 eval writes here every monitor cycle when a trade is at or near a partial trigger. Open a position and wait a cycle."
        />
      ) : (
        <>
          {/* HUB-C2 default: ONE aggregate summary line (tap to expand). Every
              value is a rolled-up statistic — no per-trade rows. Win-rate / mean
              $ are honestly "n/a": this table carries no realized outcome. The
              stat line wraps so a phone never horizontal-scrolls. */}
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((x) => !x)}
            className="tap-target flex w-full items-start gap-2 text-left"
          >
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-caption tabular-nums text-fg-muted">
              <span className="font-sans font-semibold text-fg-primary">Summary 7d</span>
              <span className="text-fg-faint">·</span>
              <span className="text-accent-mint-strong">
                {fmtCount(summary?.would_fire_trades_7d)} would-fire trades
              </span>
              <span className="text-fg-faint">·</span>
              <span className="text-accent-gold-strong">{fmtCount(summary?.near_miss_7d)} near</span>
              <span className="text-fg-faint">·</span>
              <span>{fmtCount(summary?.rows_7d)} evals</span>
              <span className="text-fg-faint">·</span>
              <span>would-fire {fmtPct(evalRate)}</span>
              <span className="text-fg-faint">·</span>
              <span className="italic text-fg-faint">n/a — no per-trade outcome</span>
            </div>
            <ChevronDown
              size={16}
              aria-hidden
              className={cn(
                "mt-0.5 shrink-0 text-fg-muted transition-transform duration-fast",
                expanded ? "rotate-180" : "rotate-0",
              )}
            />
          </button>

          {expanded && (
            <div className="mt-3 space-y-4">
              {/* Aggregate tiles — distinct-TRADE counts (honest), not eval-rows. */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <MetricTile
                  label="Would-fire trades 7d"
                  value={(summary?.would_fire_trades_7d ?? 0).toLocaleString()}
                  sub={`${(summary?.would_fire_7d ?? 0).toLocaleString()} eval-rows`}
                  size="sm"
                />
                <MetricTile
                  label="Would-fire trades 24h"
                  value={(summary?.would_fire_trades_24h ?? 0).toLocaleString()}
                  sub={`${(summary?.would_fire_24h ?? 0).toLocaleString()} eval-rows`}
                  size="sm"
                />
                <MetricTile
                  label="Near-miss 7d"
                  value={(summary?.near_miss_7d ?? 0).toLocaleString()}
                  sub={`${summary?.near_miss_24h ?? 0} in 24h`}
                  size="sm"
                />
                <MetricTile
                  label="Total evals 7d"
                  value={(summary?.rows_7d ?? 0).toLocaleString()}
                  sub={`${(summary?.rows_24h ?? 0).toLocaleString()} in 24h`}
                  size="sm"
                />
              </div>

              <p className="font-sans text-micro italic text-fg-muted">
                Counts are distinct trades. The bot re-evaluates every monitor cycle,
                so eval-rows run ~40–70× higher. No win-rate or would-have $ is shown
                — partial_trigger_shadow carries no realized per-trade outcome; the
                per-cycle profit sum was a counting artifact, not realizable money.
              </p>

              {/* Modes breakdown (aggregate) */}
              {summary && Object.keys(summary.modes).length > 0 && (
                <div className="flex flex-wrap items-center gap-2 font-sans text-micro text-fg-muted">
                  <span className="uppercase tracking-wider">Modes (7d):</span>
                  {Object.entries(summary.modes).map(([mode, n]) => (
                    <span
                      key={mode}
                      className="rounded-md border border-border-subtle bg-bg-elevated px-2 py-0.5"
                    >
                      <span className="text-fg-primary">{fmtMode(mode)}</span>
                      <span className="ml-1 font-mono">{n.toLocaleString()}</span>
                    </span>
                  ))}
                </div>
              )}

              {/* By R-trigger BANDS (aggregate sub-rows) — replaces the old
                  ~1.8k-row per-level dump. Each band folds many trades' levels. */}
              {bands.length > 0 && (
                <div>
                  <div className="mb-2 font-sans text-caption uppercase tracking-wider text-fg-muted">
                    By R-trigger band (7d) · {fmtCount(byLevel.length)} levels folded
                  </div>
                  <ul className="divide-y divide-border-subtle">
                    {bands.map((b) => (
                      <li key={b.loR} className="flex flex-wrap items-center gap-3 py-2">
                        <span className="font-mono text-sm text-accent-cyan-soft-strong">
                          {b.label}
                        </span>
                        <span className="font-sans text-micro text-fg-muted">
                          {b.levels} levels
                        </span>
                        <span className="ml-auto flex items-center gap-2 font-sans text-micro">
                          <span className="text-accent-mint-strong">{fmtCount(b.wouldFire)} would-fire</span>
                          <span className="text-fg-muted">·</span>
                          <span className="text-accent-gold-strong">{fmtCount(b.near)} near</span>
                          <span className="text-fg-muted">·</span>
                          <span className="text-fg-muted">
                            {b.dust} dust / {b.fee} fee
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* By ticker (aggregate, top 6) */}
              {byTicker.length > 0 && (
                <div>
                  <div className="mb-2 font-sans text-caption uppercase tracking-wider text-fg-muted">
                    Would-fire trades by ticker · open live positions only (7d)
                  </div>
                  <ul className="divide-y divide-border-subtle">
                    {byTicker.slice(0, 6).map((row) => (
                      <li key={row.ticker} className="flex flex-wrap items-center gap-3 py-2">
                        <span className="font-mono text-sm text-fg-primary">{row.ticker}</span>
                        <span className="ml-auto flex items-center gap-2 font-sans text-micro">
                          <span className="text-accent-mint-strong">{row.would_fire_trades} trades</span>
                          <span className="text-fg-muted">·</span>
                          <span className="text-accent-gold-strong">{row.near_miss} near</span>
                          <span className="text-fg-muted">·</span>
                          <span className="font-mono text-fg-faint">{row.would_fire} eval-rows</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
