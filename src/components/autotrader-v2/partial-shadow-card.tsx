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
import { Activity } from "lucide-react";

interface ShadowSummary {
  rows_24h: number;
  rows_7d: number;
  would_fire_24h: number;
  would_fire_7d: number;
  near_miss_24h: number;
  near_miss_7d: number;
  modes: Record<string, number>;
  would_have_profit_usd_7d: number;
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
  near_miss: number;
  would_have_profit_usd: number;
}
interface RecentRow {
  created_at: string;
  ticker: string | null;
  partial_level_r: number | null;
  partial_pct: number | null;
  current_r: number | null;
  peak_r: number | null;
  would_fire: boolean;
  skip_reason: string | null;
  near_miss: boolean;
  partials_mode: string;
  close_amount_usd: number | null;
  profit_usd: number | null;
}
interface PartialShadowResponse {
  summary: ShadowSummary;
  by_level: ByLevel[];
  by_ticker: ByTicker[];
  recent: RecentRow[];
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

function fmtAge(iso: string | null): string {
  if (!iso) return "—";
  // SQLite naive UTC string ("YYYY-MM-DD HH:MM:SS") — append Z so the
  // browser parses it as UTC, not local. Matches shadow-table-card.tsx.
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtMoney(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return `${v >= 0 ? "$" : "-$"}${Math.abs(v).toFixed(2)}`;
}

export function PartialShadowCard() {
  const [data, setData] = React.useState<PartialShadowResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

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

  if (loading && !data) {
    return <Skeleton className="h-56 w-full" />;
  }

  const summary = data?.summary;
  const byLevel = data?.by_level ?? [];
  const byTicker = data?.by_ticker ?? [];
  const recent = data?.recent ?? [];
  const hasAnyData = summary && summary.rows_7d > 0;

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
          {/* Summary tiles */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricTile
              label="Would-fire 24h"
              value={(summary?.would_fire_24h ?? 0).toLocaleString()}
              sub={`${summary?.would_fire_7d ?? 0} in 7d`}
              size="sm"
            />
            <MetricTile
              label="Near-miss 24h"
              value={(summary?.near_miss_24h ?? 0).toLocaleString()}
              sub={`${summary?.near_miss_7d ?? 0} in 7d`}
              size="sm"
            />
            <MetricTile
              label="Would-have P&L 7d"
              value={fmtMoney(summary?.would_have_profit_usd_7d ?? 0)}
              sub="sum of fired-slice profit"
              size="sm"
              tone={(summary?.would_have_profit_usd_7d ?? 0) >= 0 ? "positive" : "negative"}
            />
            <MetricTile
              label="Total evals 24h"
              value={(summary?.rows_24h ?? 0).toLocaleString()}
              sub={`${summary?.rows_7d ?? 0} in 7d`}
              size="sm"
            />
          </div>

          {/* Modes breakdown */}
          {summary && Object.keys(summary.modes).length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 font-sans text-micro text-fg-muted">
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

          {/* By R-level */}
          {byLevel.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 font-sans text-caption uppercase tracking-wider text-fg-muted">
                By R-trigger (7d)
              </div>
              <ul className="divide-y divide-border-subtle">
                {byLevel.map((row) => (
                  <li key={row.partial_level_r} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="font-mono text-sm text-accent-cyan-soft-strong">
                      {row.partial_level_r.toFixed(2)}R
                    </span>
                    <span className="font-sans text-micro text-fg-muted">
                      {row.partial_pct
                        ? `${(row.partial_pct * 100).toFixed(0)}% slice`
                        : ""}
                    </span>
                    <span className="ml-auto flex items-center gap-2 font-sans text-micro">
                      <span className="text-accent-mint-strong">{row.would_fire_7d} would-fire</span>
                      <span className="text-fg-muted">·</span>
                      <span className="text-accent-gold-strong">{row.near_miss_7d} near</span>
                      <span className="text-fg-muted">·</span>
                      <span className="text-fg-muted">
                        {row.blocked_dust_7d} dust / {row.blocked_fee_7d} fee
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* By ticker */}
          {byTicker.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 font-sans text-caption uppercase tracking-wider text-fg-muted">
                By ticker (7d)
              </div>
              <ul className="divide-y divide-border-subtle">
                {byTicker.slice(0, 6).map((row) => (
                  <li key={row.ticker} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="font-mono text-sm text-fg-primary">{row.ticker}</span>
                    <span className="ml-auto flex items-center gap-2 font-sans text-micro">
                      <span className="text-accent-mint-strong">{row.would_fire} would-fire</span>
                      <span className="text-fg-muted">·</span>
                      <span className="text-accent-gold-strong">{row.near_miss} near</span>
                      <span className="text-fg-muted">·</span>
                      <span className="font-mono text-fg-primary">
                        {fmtMoney(row.would_have_profit_usd)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recent (last 10) */}
          {recent.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 font-sans text-caption uppercase tracking-wider text-fg-muted">
                Recent (last 10)
              </div>
              <ul className="divide-y divide-border-subtle">
                {recent.map((r, idx) => (
                  <li
                    key={`${r.created_at}-${r.ticker}-${idx}`}
                    className="flex flex-wrap items-center gap-2 py-2 text-micro"
                  >
                    <span className="font-mono text-fg-primary">{r.ticker ?? "?"}</span>
                    <Pill
                      intent={r.would_fire ? "running" : r.near_miss ? "warn" : undefined}
                      tone={r.would_fire || r.near_miss ? undefined : "neutral"}
                      size="sm"
                    >
                      {r.would_fire ? "FIRE" : r.near_miss ? "NEAR" : (r.skip_reason ?? "skip")}
                    </Pill>
                    <span className="font-mono text-fg-muted">
                      {r.current_r !== null ? r.current_r.toFixed(2) : "—"}R /{" "}
                      {r.partial_level_r !== null ? r.partial_level_r.toFixed(2) : "—"}R
                    </span>
                    <span className="font-sans text-fg-muted">{fmtMode(r.partials_mode)}</span>
                    {r.profit_usd !== null && (
                      <span className="font-mono text-fg-primary">
                        {fmtMoney(r.profit_usd)}
                      </span>
                    )}
                    <span className="ml-auto font-mono text-fg-faint" title={r.created_at}>
                      {fmtAge(r.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
